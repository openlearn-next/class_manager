import type { PluginContext } from '@openlearn/plugin-sdk';
import type {
  ClassItem,
  StudentItem,
  StudentGroup,
  AttendanceRecord,
  AttendanceStatus,
  ClassSummaryReport,
} from './types';

const DATABASE_TOKEN = { name: '@openlearn/core:IDatabase' } as any;

export default {
  manifest: {
    id: '@ext/class-manager',
    name: '班级与学生管理增强',
    version: '0.3.8',
    description: '提供班级花名册导入、智能分组、互动白板课堂单个/批量加减分、小组PK激励、原子白板投射与真实学情聚合统计',
    author: 'OpenLearn',
    engines: { openlearn: '>=0.2.0' },
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    capabilitiesProposed: ['lesson:read', 'lesson:write', 'management:read', 'management:write'],
    contributes: {
      'classroom.tool': [
        {
          id: 'class-mgr-tool',
          name: '课堂加分与点名',
          icon: 'Award',
          commandType: 'class_mgr.draw_widget',
          payload: {
            type: 'plugin',
            data: JSON.stringify({
              teacherWidgetId: 'class-mgr-widget',
              title: '课堂加分与点名',
              width: 380,
              height: 480,
            }),
          },
        },
      ],
      'teacher.dashboard.widget': [
        {
          id: 'class-mgr-widget',
          label: '课堂加分与点名',
          icon: 'Award',
          position: 0,
        },
      ],
      'teacher.tab': [
        {
          id: 'class-mgr-teacher-tab',
          label: '班级管理',
          icon: 'Users',
          position: 10,
        },
      ],
    },
    classroomTools: [
      {
        id: 'class-mgr-tool',
        name: '课堂加分与点名',
        icon: 'Award',
        commandType: 'class_mgr.draw_widget',
        payload: {
          type: 'plugin',
          data: JSON.stringify({
            teacherWidgetId: 'class-mgr-widget',
            title: '课堂加分与点名',
            width: 380,
            height: 480,
          }),
        },
      },
    ],
  },

  async activate(ctx: PluginContext) {
    const commandBus = ctx.services.commandBus;
    const actionRegistry = ctx.services.actionRegistry;
    const eventBus = ctx.services.eventBus;

    // 1. 初始化插件增强私有数据库表结构
    await ctx.db.ensureTable('classes', `
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      code TEXT NOT NULL,
      grade TEXT,
      description TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    `);

    await ctx.db.ensureTable('students', `
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      student_no TEXT NOT NULL,
      name TEXT NOT NULL,
      gender TEXT,
      group_id TEXT,
      points INTEGER DEFAULT 0,
      tags TEXT,
      avatar TEXT,
      created_at INTEGER NOT NULL
    `);

    await ctx.db.ensureTable('groups', `
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      name TEXT NOT NULL,
      color TEXT,
      leader_student_id TEXT,
      created_at INTEGER NOT NULL
    `);

    await ctx.db.ensureTable('attendance', `
      id TEXT PRIMARY KEY,
      class_id TEXT NOT NULL,
      lesson_id TEXT NOT NULL,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL,
      remark TEXT,
      timestamp INTEGER NOT NULL
    `);

    const classesTable = ctx.db.table('classes');
    const studentsTable = ctx.db.table('students');
    const groupsTable = ctx.db.table('groups');
    const attendanceTable = ctx.db.table('attendance');

    const getDb = async (): Promise<any> => {
      return await ctx.resolve(DATABASE_TOKEN);
    };

    // 异步事务封装：适配 Worker 跨线程 RPC 模式
    const withTransaction = async (database: any, fn: () => Promise<void>) => {
      await database.prepare('BEGIN TRANSACTION').run();
      try {
        await fn();
        await database.prepare('COMMIT').run();
      } catch (err) {
        try {
          await database.prepare('ROLLBACK').run();
        } catch (_) {}
        throw err;
      }
    };

    // 为高频检索字段创建索引（全部 await）
    const db = await getDb();
    try {
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_class_mgr_students_class ON ${studentsTable} (class_id)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_class_mgr_attendance_class_lesson ON ${attendanceTable} (class_id, lesson_id)`).run();
      await db.prepare(`CREATE INDEX IF NOT EXISTS idx_class_mgr_groups_class ON ${groupsTable} (class_id)`).run();
    } catch (_) {}

    // 双向全量补偿与宿主系统数据同步（确保宿主白板上课、专注力监控、排课 100% 可见插件班级与学生）
    const syncAllToHost = async (database: any) => {
      const now = Date.now();
      let syncedClasses = 0;
      let syncedStudents = 0;

      // 1. 同步班级数据至宿主 classes 表
      try {
        const pluginClasses = await database.prepare(`SELECT * FROM ${classesTable}`).all();
        if (Array.isArray(pluginClasses)) {
          for (const cls of pluginClasses) {
            await database.prepare(
              `INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)`
            ).run(cls.id, cls.name, cls.description || '', cls.created_at || now);
            syncedClasses++;
          }
        }
      } catch (e) {
        console.warn('[class-manager] 同步班级至宿主 classes 表失败:', e);
      }

      // 2. 同步学生与选课数据至宿主 students / class_students 表
      try {
        const pluginStudents = await database.prepare(`SELECT * FROM ${studentsTable}`).all();
        if (Array.isArray(pluginStudents)) {
          for (const stu of pluginStudents) {
            await database.prepare(
              `INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)`
            ).run(stu.id, stu.student_no, stu.name, '', stu.created_at || now);

            if (stu.class_id) {
              await database.prepare(
                `INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)`
              ).run(stu.class_id, stu.id, stu.created_at || now);
            }
            syncedStudents++;
          }
        }
      } catch (e) {
        console.warn('[class-manager] 同步学生至宿主 students / class_students 表失败:', e);
      }

      // 3. 为白板上课系统补充排课 schedules 与进度初始化，确保白板专注力监控 100% 识别学生
      try {
        const lessons = await database.prepare(`SELECT id FROM lessons`).all();
        const hostClasses = await database.prepare(`SELECT id FROM classes`).all();
        if (Array.isArray(lessons) && Array.isArray(hostClasses)) {
          for (const les of lessons) {
            for (const cls of hostClasses) {
              await database.prepare(
                `INSERT OR IGNORE INTO schedules (id, class_id, lesson_id, scheduled_date, status, created_at) VALUES (?, ?, ?, ?, 'scheduled', ?)`
              ).run(`${cls.id}_${les.id}`, cls.id, les.id, new Date().toISOString().slice(0, 10), now);
            }
          }
        }
      } catch (_) {}

      return { syncedClasses, syncedStudents };
    };

    // 插件启动时立即执行一次全量补偿
    try {
      await syncAllToHost(db);
    } catch (_) {}

    // 命令注册辅助器（同时注册 class_mgr.* 命名空间命令和短名命令，保证前后端 100% 互通）
    const regHandler = async (cmdType: string, handler: any) => {
      await commandBus.registerHandler(cmdType, handler);
      if (cmdType.startsWith('class_mgr.')) {
        const shortType = cmdType.replace('class_mgr.', '');
        try {
          await commandBus.registerHandler(shortType, handler);
        } catch (_) {}
      }
    };

    // 注册手动全量同步命令
    await regHandler('class_mgr.sync_to_host', {
      async execute() {
        const database = await getDb();
        const res = await syncAllToHost(database);
        return { success: true, ...res, message: `已成功同步 ${res.syncedClasses} 个班级、${res.syncedStudents} 名学生至宿主系统白板！` };
      },
    });

    // 2. 注册 classroomTools 对应的白板小挂件绘制代理 Handler（直接原子写入 whiteboard_elements 表，彻底消除跨 Worker RPC DataCloneError）
    await regHandler('class_mgr.draw_widget', {
      async execute(command: any) {
        const payload = command.payload || {};
        let lessonId = payload.lessonId;
        const database = await getDb();

        if (!lessonId) {
          try {
            const latestLesson = (await database.prepare(`SELECT id FROM lessons ORDER BY created_at DESC LIMIT 1`).get()) as any;
            if (latestLesson?.id) {
              lessonId = latestLesson.id;
            }
          } catch (_) {}
        }

        if (!lessonId) {
          lessonId = 'default_lesson';
        }

        const dataObj = typeof payload.data === 'string'
          ? (() => { try { return JSON.parse(payload.data); } catch { return {}; } })()
          : (payload.data || {});

        const finalData = {
          teacherWidgetId: 'class-mgr-widget',
          pluginId: '@ext/class-manager',
          title: '课堂加分与点名',
          x: payload.x ?? dataObj.x ?? 120,
          y: payload.y ?? dataObj.y ?? 100,
          width: payload.width ?? dataObj.width ?? 440,
          height: payload.height ?? dataObj.height ?? 520,
          page: payload.page ?? dataObj.page ?? 0,
          ...dataObj,
        };
        const dataStr = JSON.stringify(finalData);
        const elementId = crypto.randomUUID();
        const now = Date.now();

        try {
          // 直接写入宿主系统的 whiteboard_elements 表
          await database.prepare(
            `INSERT INTO whiteboard_elements (id, lesson_id, type, data, created_at) VALUES (?, ?, ?, ?, ?)`
          ).run(elementId, lessonId, payload.type || 'plugin', dataStr, now);

          // 广播白板更新事件，触发白板画布立即拉取并渲染卡片
          try {
            await eventBus.publish({
              id: crypto.randomUUID(),
              type: 'whiteboard.element_updated',
              source: 'plugin.@ext/class-manager',
              payload: { lessonId, elementId },
              timestamp: now,
              correlationId: command?.id,
            });
            await eventBus.publish({
              id: crypto.randomUUID(),
              type: 'class_mgr.open_floating_widget',
              source: 'plugin.@ext/class-manager',
              payload: { open: true, timestamp: now },
              timestamp: now,
              correlationId: command?.id,
            });
          } catch (_) {}

          return { success: true, elementId, lessonId };
        } catch (err: any) {
          console.warn('[class_mgr.draw_widget] 写入白板元素异常:', err);
          return { success: false, error: err.message || String(err) };
        }
      },
    });

    await regHandler('class_mgr.open_tool', {
      async execute(command: any) {
        try {
          await eventBus.publish({
            id: crypto.randomUUID(),
            type: 'class_mgr.open_floating_widget',
            source: 'plugin.@ext/class-manager',
            payload: { open: true, timestamp: Date.now() },
            timestamp: Date.now(),
            correlationId: command?.id,
          });
        } catch (_) {}
        return { panel: 'class_mgr_tool', visible: true };
      },
    });

    // 3. 注册班级相关 Handler（双源融合：打通宿主原生 classes 表 + 插件扩展 classes 表 + 宿主 CommandBus 兜底）
    await regHandler('class_mgr.class_create', {
      async execute(command: any) {
        const payload = (command.payload || {}) as { name: string; code?: string; grade?: string; description?: string };
        const id = crypto.randomUUID();
        const now = Date.now();
        const code = payload.code || `CLS-${Math.floor(1000 + Math.random() * 9000)}`;

        const database = await getDb();

        // 1. 优先同步写入宿主原生 classes 表（让白板系统与其他内置模块立即可见）
        try {
          await database.prepare(
            `INSERT OR REPLACE INTO classes (id, name, description, created_at) VALUES (?, ?, ?, ?)`
          ).run(id, payload.name, payload.description || '', now);
        } catch (e) {
          console.warn('[class-manager] 写入宿主 classes 表跳过:', e);
        }

        // 2. 写入插件增强表
        await database.prepare(
          `INSERT OR REPLACE INTO ${classesTable} (id, name, code, grade, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)`
        ).run(id, payload.name, code, payload.grade || '', payload.description || '', now, now);

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'class_mgr.class_created',
          source: 'plugin.class_mgr',
          payload: { id, name: payload.name, code },
          timestamp: now,
          correlationId: command.id,
        });

        return { id, name: payload.name, code, message: `班级「${payload.name}」创建成功` };
      },
    });

    await regHandler('class_mgr.class_list', {
      async execute() {
        const database = await getDb();
        const classMap = new Map<string, ClassItem>();

        // 1. 查询宿主原生 classes 表中的历史班级（await 异步 RPC）
        try {
          const hostRows = await database.prepare(`SELECT id, name, description, created_at FROM classes ORDER BY created_at DESC`).all();
          if (Array.isArray(hostRows)) {
            for (const row of hostRows) {
              let hostStudentCount = 0;
              try {
                const countRow = await database.prepare(`SELECT COUNT(*) as count FROM class_students WHERE class_id = ?`).get(row.id);
                hostStudentCount = countRow?.count || 0;
              } catch (_) {}

              classMap.set(row.id, {
                id: row.id,
                name: row.name,
                code: `HOST-${row.id.slice(0, 6)}`,
                description: row.description || '',
                studentCount: hostStudentCount,
                source: 'host',
                createdAt: row.created_at || Date.now(),
                updatedAt: row.created_at || Date.now(),
              });
            }
          }
        } catch (_) {}

        // 2. 兜底方案：通过宿主全局命令 class.list 获取
        if (classMap.size === 0) {
          try {
            const hostCmd = await commandBus.createCommand('class.list', {}, ctx.pluginId);
            const cmdRes = (await commandBus.execute(hostCmd)) as any;
            if (cmdRes?.classes && Array.isArray(cmdRes.classes)) {
              for (const c of cmdRes.classes) {
                classMap.set(c.id, {
                  id: c.id,
                  name: c.name,
                  code: `HOST-${c.id.slice(0, 6)}`,
                  description: c.description || '',
                  studentCount: 0,
                  source: 'host',
                  createdAt: c.created_at || Date.now(),
                  updatedAt: c.created_at || Date.now(),
                });
              }
            }
          } catch (_) {}
        }

        // 3. 查询插件自建/增强 classes 表（await 异步 RPC）
        try {
          const pluginRows = await database.prepare(`SELECT * FROM ${classesTable} ORDER BY created_at DESC`).all();
          if (Array.isArray(pluginRows)) {
            for (const row of pluginRows) {
              const countRow = await database.prepare(`SELECT COUNT(*) as count FROM ${studentsTable} WHERE class_id = ?`).get(row.id);
              const studentCount = countRow?.count || 0;

              const existing = classMap.get(row.id);
              classMap.set(row.id, {
                id: row.id,
                name: row.name,
                code: row.code,
                grade: row.grade,
                description: row.description,
                studentCount: Math.max(studentCount, existing?.studentCount || 0),
                source: existing ? 'host' : 'plugin',
                createdAt: row.created_at,
                updatedAt: row.updated_at,
              });
            }
          }
        } catch (_) {}

        return Array.from(classMap.values());
      },
    });

    // 4. 注册学生花名册相关 Handler（双源同步）
    await regHandler('class_mgr.student_batch_import', {
      async execute(command: any) {
        const payload = (command.payload || {}) as {
          classId: string;
          students: { studentNo: string; name: string; gender?: 'male' | 'female' | 'other'; tags?: string[] }[];
        };

        if (!payload.classId || !Array.isArray(payload.students) || payload.students.length === 0) {
          throw new Error('无效的导入参数：classId 与 students 数组不能为空');
        }

        const database = await getDb();
        const now = Date.now();
        let inserted = 0;

        await withTransaction(database, async () => {
          for (const stu of payload.students) {
            // 1. 检查宿主原生 students 表是否已有该学生
            let existingStudent = (await database.prepare(`SELECT id FROM students WHERE student_number = ? OR name = ?`).get(stu.studentNo, stu.name)) as any;
            let targetStudentId = existingStudent ? existingStudent.id : crypto.randomUUID();

            if (!existingStudent) {
              try {
                await database.prepare(`INSERT OR REPLACE INTO students (id, student_number, name, email, created_at) VALUES (?, ?, ?, ?, ?)`).run(
                  targetStudentId,
                  stu.studentNo,
                  stu.name,
                  '',
                  now
                );
              } catch (_) {}
            }

            // 2. 关联到宿主原生 class_students 选课表
            try {
              await database.prepare(`INSERT OR REPLACE INTO class_students (class_id, student_id, joined_at) VALUES (?, ?, ?)`).run(
                payload.classId,
                targetStudentId,
                now
              );
            } catch (_) {}

            // 3. 写入插件扩展 students 表（增强积分、分组与画像）
            await database.prepare(
              `INSERT OR REPLACE INTO ${studentsTable} (id, class_id, student_no, name, gender, points, tags, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
            ).run(
              targetStudentId,
              payload.classId,
              stu.studentNo,
              stu.name,
              stu.gender || 'other',
              JSON.stringify(stu.tags || []),
              now
            );

            inserted++;
          }
        });

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'class_mgr.students_imported',
          source: 'plugin.class_mgr',
          payload: { classId: payload.classId, count: inserted },
          timestamp: now,
          correlationId: command.id,
        });

        return { count: inserted, message: `成功导入 ${inserted} 名学生花名册` };
      },
    });

    await regHandler('class_mgr.student_list', {
      async execute(command: any) {
        const payload = (command.payload || {}) as { classId: string };
        const database = await getDb();

        // 1. 先查插件私有增强表（await 异步 RPC）
        const pluginRows = await database.prepare(
          `SELECT s.*, g.name as group_name FROM ${studentsTable} s 
           LEFT JOIN ${groupsTable} g ON s.group_id = g.id 
           WHERE s.class_id = ? 
           ORDER BY s.student_no ASC`
        ).all(payload.classId) as any[];

        const studentMap = new Map<string, StudentItem>();
        if (Array.isArray(pluginRows)) {
          for (const row of pluginRows) {
            studentMap.set(row.id, {
              id: row.id,
              classId: row.class_id,
              studentNo: row.student_no,
              name: row.name,
              gender: row.gender,
              groupId: row.group_id,
              groupName: row.group_name,
              points: row.points || 0,
              tags: row.tags ? JSON.parse(row.tags) : [],
              avatar: row.avatar,
              createdAt: row.created_at,
            });
          }
        }

        // 2. 如果是宿主原生班级，查询宿主 class_students 与 students 表中尚未同步进来的学生（await 异步 RPC）
        try {
          const hostStudentRows = await database.prepare(
            `SELECT s.id, s.student_number, s.name, s.email, cs.joined_at 
             FROM class_students cs 
             JOIN students s ON cs.student_id = s.id 
             WHERE cs.class_id = ?`
          ).all(payload.classId) as any[];

          if (Array.isArray(hostStudentRows)) {
            const now = Date.now();
            for (const hs of hostStudentRows) {
              if (!studentMap.has(hs.id)) {
                const stuNo = hs.student_number || `S-${hs.id.slice(0, 4)}`;
                try {
                  await database.prepare(
                    `INSERT OR IGNORE INTO ${studentsTable} (id, class_id, student_no, name, gender, points, tags, created_at) VALUES (?, ?, ?, ?, ?, 0, ?, ?)`
                  ).run(hs.id, payload.classId, stuNo, hs.name, 'other', '[]', now);
                } catch (_) {}

                studentMap.set(hs.id, {
                  id: hs.id,
                  classId: payload.classId,
                  studentNo: stuNo,
                  name: hs.name,
                  gender: 'other',
                  points: 0,
                  tags: ['宿主原生学生'],
                  createdAt: hs.joined_at || now,
                });
              }
            }
          }
        } catch (_) {}

        return Array.from(studentMap.values());
      },
    });

    await regHandler('class_mgr.student_update_points', {
      async execute(command: any) {
        const payload = (command.payload || {}) as {
          studentId: string;
          delta: number;
          reason?: string;
        };

        if (!payload.studentId || typeof payload.delta !== 'number') {
          throw new Error('无效的参数：studentId 与 delta 必填');
        }

        const database = await getDb();
        const now = Date.now();

        let existing = (await database.prepare(`SELECT * FROM ${studentsTable} WHERE id = ?`).get(payload.studentId)) as any;
        if (!existing) {
          // 若插件表中尚未有该学生（例如宿主原生录入的学生），自动增量同步
          try {
            const hostStu = (await database.prepare(`SELECT * FROM students WHERE id = ?`).get(payload.studentId)) as any;
            if (hostStu) {
              const stuClass = (await database.prepare(`SELECT class_id FROM class_students WHERE student_id = ?`).get(payload.studentId)) as any;
              const classId = stuClass?.class_id || '';
              const stuNo = hostStu.student_number || `S-${hostStu.id.slice(0, 4)}`;
              await database.prepare(
                `INSERT INTO ${studentsTable} (id, class_id, student_no, name, gender, points, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
              ).run(hostStu.id, classId, stuNo, hostStu.name, 'other', payload.delta, '[]', now);
            }
          } catch (_) {}
        } else {
          await database.prepare(`UPDATE ${studentsTable} SET points = points + ? WHERE id = ?`).run(payload.delta, payload.studentId);
        }

        const updated = (await database.prepare(`SELECT * FROM ${studentsTable} WHERE id = ?`).get(payload.studentId)) as any;

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'class_mgr.points_changed',
          source: 'plugin.class_mgr',
          payload: {
            studentId: payload.studentId,
            studentName: updated?.name,
            delta: payload.delta,
            currentPoints: updated?.points || 0,
            reason: payload.reason,
          },
          timestamp: now,
          correlationId: command.id,
        });

        return {
          studentId: payload.studentId,
          points: updated?.points || 0,
          delta: payload.delta,
          name: updated?.name || '',
          message: `学生 ${updated?.name || ''} 积分调整为 ${updated?.points || 0} (${payload.delta >= 0 ? '+' : ''}${payload.delta})`,
        };
      },
    });

    await regHandler('class_mgr.student_batch_update_points', {
      async execute(command: any) {
        const payload = (command.payload || {}) as {
          studentIds: string[];
          delta: number;
          reason?: string;
        };

        if (!Array.isArray(payload.studentIds) || payload.studentIds.length === 0 || typeof payload.delta !== 'number') {
          throw new Error('无效的参数：studentIds 列表与 delta 必填');
        }

        const database = await getDb();
        const now = Date.now();
        const results: { studentId: string; name: string; points: number }[] = [];

        await withTransaction(database, async () => {
          for (const sId of payload.studentIds) {
            let existing = (await database.prepare(`SELECT * FROM ${studentsTable} WHERE id = ?`).get(sId)) as any;
            if (!existing) {
              try {
                const hostStu = (await database.prepare(`SELECT * FROM students WHERE id = ?`).get(sId)) as any;
                if (hostStu) {
                  const stuClass = (await database.prepare(`SELECT class_id FROM class_students WHERE student_id = ?`).get(sId)) as any;
                  const classId = stuClass?.class_id || '';
                  const stuNo = hostStu.student_number || `S-${hostStu.id.slice(0, 4)}`;
                  await database.prepare(
                    `INSERT INTO ${studentsTable} (id, class_id, student_no, name, gender, points, tags, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
                  ).run(hostStu.id, classId, stuNo, hostStu.name, 'other', payload.delta, '[]', now);
                }
              } catch (_) {}
            } else {
              await database.prepare(`UPDATE ${studentsTable} SET points = points + ? WHERE id = ?`).run(payload.delta, sId);
            }

            const updated = (await database.prepare(`SELECT * FROM ${studentsTable} WHERE id = ?`).get(sId)) as any;
            if (updated) {
              results.push({ studentId: sId, name: updated.name, points: updated.points });
              await eventBus.publish({
                id: crypto.randomUUID(),
                type: 'class_mgr.points_changed',
                source: 'plugin.class_mgr',
                payload: {
                  studentId: sId,
                  studentName: updated.name,
                  delta: payload.delta,
                  currentPoints: updated.points,
                  reason: payload.reason,
                },
                timestamp: now,
                correlationId: command.id,
              });
            }
          }
        });

        return {
          count: results.length,
          delta: payload.delta,
          results,
          message: `已成功为 ${results.length} 名学生调整积分 (${payload.delta >= 0 ? '+' : ''}${payload.delta})`,
        };
      },
    });

    // 5. 注册智能/随机分组 Handler（异步事务保障）
    await regHandler('class_mgr.group_generate', {
      async execute(command: any) {
        const payload = (command.payload || {}) as {
          classId: string;
          groupCount: number;
          method?: 'random' | 'gender_balance';
        };

        const database = await getDb();
        const students = await database.prepare(`SELECT * FROM ${studentsTable} WHERE class_id = ?`).all(payload.classId) as any[];
        if (!Array.isArray(students) || students.length === 0) {
          throw new Error('当前班级暂无学生，无法分组');
        }

        const count = Math.max(1, Math.min(payload.groupCount || 4, students.length));
        const now = Date.now();
        const groupIds: string[] = [];
        const groupColors = ['#1677ff', '#52c41a', '#faad14', '#f5222d', '#722ed1', '#13c2c2', '#eb2f96'];

        await withTransaction(database, async () => {
          await database.prepare(`DELETE FROM ${groupsTable} WHERE class_id = ?`).run(payload.classId);
          await database.prepare(`UPDATE ${studentsTable} SET group_id = NULL WHERE class_id = ?`).run(payload.classId);

          for (let i = 0; i < count; i++) {
            const gId = crypto.randomUUID();
            const gName = `第 ${i + 1} 小组`;
            const color = groupColors[i % groupColors.length];
            await database.prepare(`INSERT INTO ${groupsTable} (id, class_id, name, color, created_at) VALUES (?, ?, ?, ?, ?)`).run(
              gId,
              payload.classId,
              gName,
              color,
              now
            );
            groupIds.push(gId);
          }

          const shuffled = [...students].sort(() => Math.random() - 0.5);
          for (let idx = 0; idx < shuffled.length; idx++) {
            const stu = shuffled[idx];
            const assignedGroupId = groupIds[idx % count];
            await database.prepare(`UPDATE ${studentsTable} SET group_id = ? WHERE id = ?`).run(assignedGroupId, stu.id);
          }
        });

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'class_mgr.groups_updated',
          source: 'plugin.class_mgr',
          payload: { classId: payload.classId, groupCount: count },
          timestamp: now,
          correlationId: command.id,
        });

        return { success: true, groupCount: count, message: `已成功划分 ${count} 个小组` };
      },
    });

    await regHandler('class_mgr.group_list', {
      async execute(command: any) {
        const payload = (command.payload || {}) as { classId: string };
        const database = await getDb();
        const groups = await database.prepare(`SELECT * FROM ${groupsTable} WHERE class_id = ? ORDER BY name ASC`).all(payload.classId) as any[];

        const result: StudentGroup[] = [];
        if (Array.isArray(groups)) {
          for (const g of groups) {
            const members = await database.prepare(`SELECT id FROM ${studentsTable} WHERE group_id = ?`).all(g.id) as any[];
            result.push({
              id: g.id,
              classId: g.class_id,
              name: g.name,
              color: g.color,
              leaderStudentId: g.leader_student_id,
              studentIds: Array.isArray(members) ? members.map((m) => m.id) : [],
              createdAt: g.created_at,
            });
          }
        }

        return result;
      },
    });

    // 6. 注册随机点名与抽选 Handler
    await regHandler('class_mgr.rollcall_pick', {
      async execute(command: any) {
        const payload = (command.payload || {}) as {
          classId: string;
          lessonId?: string;
          count?: number;
          excludeStudentIds?: string[];
        };

        const database = await getDb();
        let query = `SELECT * FROM ${studentsTable} WHERE class_id = ?`;
        const params: any[] = [payload.classId];

        if (payload.excludeStudentIds && payload.excludeStudentIds.length > 0) {
          const placeholders = payload.excludeStudentIds.map(() => '?').join(',');
          query += ` AND id NOT IN (${placeholders})`;
          params.push(...payload.excludeStudentIds);
        }

        const candidates = await database.prepare(query).all(...params) as any[];
        if (!Array.isArray(candidates) || candidates.length === 0) {
          throw new Error('无可抽选的学生候选人');
        }

        const pickCount = Math.min(payload.count || 1, candidates.length);
        const shuffled = [...candidates].sort(() => Math.random() - 0.5);
        const picked = shuffled.slice(0, pickCount);
        const now = Date.now();

        for (const stu of picked) {
          await eventBus.publish({
            id: crypto.randomUUID(),
            type: 'class_mgr.student_picked',
            source: 'plugin.class_mgr',
            payload: {
              classId: payload.classId,
              studentId: stu.id,
              studentName: stu.name,
              studentNo: stu.student_no,
              lessonId: payload.lessonId,
            },
            timestamp: now,
            correlationId: command.id,
          });
        }

        return {
          picked: picked.map((stu) => ({
            studentId: stu.id,
            name: stu.name,
            studentNo: stu.student_no,
            points: stu.points || 0,
          })),
        };
      },
    });

    // 7. 注册课堂考勤 Handler（异步事务批量保存）
    await regHandler('class_mgr.attendance_record', {
      async execute(command: any) {
        const payload = (command.payload || {}) as {
          classId: string;
          lessonId: string;
          records: { studentId: string; status: AttendanceStatus; remark?: string }[];
        };

        const database = await getDb();
        const now = Date.now();

        await withTransaction(database, async () => {
          for (const rec of payload.records) {
            await database.prepare(`DELETE FROM ${attendanceTable} WHERE class_id = ? AND lesson_id = ? AND student_id = ?`).run(
              payload.classId,
              payload.lessonId,
              rec.studentId
            );
            await database.prepare(`
              INSERT INTO ${attendanceTable} (id, class_id, lesson_id, student_id, status, remark, timestamp)
              VALUES (?, ?, ?, ?, ?, ?, ?)
            `).run(
              crypto.randomUUID(),
              payload.classId,
              payload.lessonId,
              rec.studentId,
              rec.status,
              rec.remark || '',
              now
            );
          }
        });

        await eventBus.publish({
          id: crypto.randomUUID(),
          type: 'class_mgr.attendance_saved',
          source: 'plugin.class_mgr',
          payload: { classId: payload.classId, lessonId: payload.lessonId, count: payload.records.length },
          timestamp: now,
          correlationId: command.id,
        });

        return { success: true, count: payload.records.length, message: '考勤记录已保存' };
      },
    });

    await regHandler('class_mgr.attendance_list', {
      async execute(command: any) {
        const payload = (command.payload || {}) as { classId: string; lessonId: string };
        const database = await getDb();
        const rows = await database.prepare(
          `SELECT a.*, s.name as student_name, s.student_no 
           FROM ${attendanceTable} a
           LEFT JOIN ${studentsTable} s ON a.student_id = s.id
           WHERE a.class_id = ? AND a.lesson_id = ?`
        ).all(payload.classId, payload.lessonId) as any[];

        const records: AttendanceRecord[] = Array.isArray(rows)
          ? rows.map((r) => ({
              id: r.id,
              classId: r.class_id,
              lessonId: r.lesson_id,
              studentId: r.student_id,
              studentName: r.student_name,
              studentNo: r.student_no,
              status: r.status,
              remark: r.remark,
              timestamp: r.timestamp,
            }))
          : [];

        return records;
      },
    });

    // 8. 班级学情与真实聚合统计 Handler（兼容宿主原生班级）
    await regHandler('class_mgr.class_summary', {
      async execute(command: any) {
        const payload = (command.payload || {}) as { classId: string };
        const database = await getDb();

        let className = '未知班级';
        const classInfo = await database.prepare(`SELECT * FROM ${classesTable} WHERE id = ?`).get(payload.classId) as any;
        if (classInfo) {
          className = classInfo.name;
        } else {
          try {
            const hostClass = await database.prepare(`SELECT * FROM classes WHERE id = ?`).get(payload.classId) as any;
            if (hostClass) {
              className = hostClass.name;
            }
          } catch (_) {}
        }

        const studentCountRow = await database.prepare(`SELECT COUNT(*) as count FROM ${studentsTable} WHERE class_id = ?`).get(payload.classId) as any;
        const groupCountRow = await database.prepare(`SELECT COUNT(*) as count FROM ${groupsTable} WHERE class_id = ?`).get(payload.classId) as any;
        
        const attStatsRow = await database.prepare(`
          SELECT 
            COUNT(*) as total_records,
            COALESCE(SUM(CASE WHEN status = 'present' THEN 1 ELSE 0 END), 0) as present_count,
            COALESCE(SUM(CASE WHEN status = 'late' THEN 1 ELSE 0 END), 0) as late_count,
            COALESCE(SUM(CASE WHEN status = 'leave' THEN 1 ELSE 0 END), 0) as leave_count,
            COALESCE(SUM(CASE WHEN status = 'absent' THEN 1 ELSE 0 END), 0) as absent_count
          FROM ${attendanceTable}
          WHERE class_id = ?
        `).get(payload.classId) as any;

        const totalRecords = attStatsRow?.total_records || 0;
        const presentCount = attStatsRow?.present_count || 0;
        const lateCount = attStatsRow?.late_count || 0;
        const leaveCount = attStatsRow?.leave_count || 0;
        const absentCount = attStatsRow?.absent_count || 0;

        const attendanceRate = totalRecords > 0
          ? Math.round(((presentCount + lateCount * 0.8) / totalRecords) * 1000) / 10
          : 100.0;

        const ptsStatsRow = await database.prepare(`
          SELECT 
            COALESCE(AVG(points), 0) as avg_points,
            COALESCE(MAX(points), 0) as max_points,
            COALESCE(MIN(points), 0) as min_points,
            COALESCE(SUM(points), 0) as total_points
          FROM ${studentsTable}
          WHERE class_id = ?
        `).get(payload.classId) as any;

        const topStudents = await database.prepare(`SELECT name, points FROM ${studentsTable} WHERE class_id = ? ORDER BY points DESC LIMIT 5`).all(payload.classId) as any[];

        const summary: ClassSummaryReport = {
          classId: payload.classId,
          className,
          totalStudents: studentCountRow?.count || 0,
          totalGroups: groupCountRow?.count || 0,
          attendanceRate,
          attendanceStats: {
            totalRecords,
            presentCount,
            lateCount,
            leaveCount,
            absentCount,
          },
          pointsStats: {
            avgPoints: Math.round((ptsStatsRow?.avg_points || 0) * 10) / 10,
            maxPoints: ptsStatsRow?.max_points || 0,
            minPoints: ptsStatsRow?.min_points || 0,
            totalPoints: ptsStatsRow?.total_points || 0,
          },
          topActiveStudents: Array.isArray(topStudents) ? topStudents.map((s) => ({ name: s.name, points: s.points || 0 })) : [],
          summaryText: `班级「${className}」共有学生 ${studentCountRow?.count || 0} 人，分为 ${groupCountRow?.count || 0} 个教学小组。加权出勤率为 ${attendanceRate}%，平均课堂积分为 ${Math.round((ptsStatsRow?.avg_points || 0) * 10) / 10} 分。`,
        };

        return summary;
      },
    });

    // 9. 注册 AI Agent Tools (ActionRegistry)
    await actionRegistry.register({
      id: 'class_mgr-ai-rollcall',
      commandType: 'class_mgr.rollcall_pick',
      description: 'AI 课堂智能随机抽选/点名学生回答问题或互动（支持宿主班级与增强班级）',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          lessonId: { type: 'STRING', description: '当前课堂/课节 ID (可选)' },
          count: { type: 'INTEGER', description: '抽选人数 (默认 1 人)' },
        },
        required: ['classId'],
      },
    });

    await actionRegistry.register({
      id: 'class_mgr-ai-group',
      commandType: 'class_mgr.group_generate',
      description: 'AI 智能根据班级人数自动生成均衡协作小组（支持宿主原生班级学生）',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
          groupCount: { type: 'INTEGER', description: '需要划分的小组数量' },
          method: { type: 'STRING', description: '分组策略 (random / gender_balance)' },
        },
        required: ['classId', 'groupCount'],
      },
    });

    await actionRegistry.register({
      id: 'class_mgr-ai-attendance-summary',
      commandType: 'class_mgr.class_summary',
      description: 'AI 汇总分析班级成员情况、分组分布、学情积分与综合活跃度（支持宿主班级）',
      capabilityRequired: 'lesson:read',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          classId: { type: 'STRING', description: '班级 ID' },
        },
        required: ['classId'],
      },
    });

    await actionRegistry.register({
      id: 'class_mgr-ai-batch-points',
      commandType: 'class_mgr.student_batch_update_points',
      description: 'AI 课堂批量或针对特定学生/小组奖励或扣除积分',
      capabilityRequired: 'lesson:write',
      inputSchema: {
        type: 'OBJECT',
        properties: {
          studentIds: { type: 'ARRAY', description: '学生 ID 列表' },
          delta: { type: 'INTEGER', description: '积分变动值 (如 2, 3, -1)' },
          reason: { type: 'STRING', description: '加减分理由' },
        },
        required: ['studentIds', 'delta'],
      },
    });

    ctx.log.info('[@ext/class-manager] 插件激活成功，已启用白板课堂批量奖惩与全异步 RPC 支持。');
  },

  async deactivate() {
    // 清理资源
  },
};
