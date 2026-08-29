import type ReactType from 'react';

declare const window: any;
const React: typeof ReactType = typeof window !== 'undefined' ? (window.HostSharedDeps?.React || window.React) : ({} as any);
const ReactDOM: any = typeof window !== 'undefined' ? (window.HostSharedDeps?.ReactDOM || window.ReactDOM) : ({} as any);

let hostContext: any = null;

// ==========================================
// 插件内部响应式事件总线 (支持多组件局部实时响应)
// ==========================================
type EventCallback = (payload: any) => void;

class PluginEventHub {
  private listeners: Map<string, Set<EventCallback>> = new Map();

  on(event: string, cb: EventCallback): () => void {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(cb);
    return () => this.off(event, cb);
  }

  off(event: string, cb: EventCallback) {
    this.listeners.get(event)?.delete(cb);
  }

  emit(event: string, payload: any) {
    this.listeners.get(event)?.forEach((cb) => {
      try {
        cb(payload);
      } catch (err) {
        console.error(`[@openlearn/class-manager] 事件处理异常 (${event}):`, err);
      }
    });
  }

  clear() {
    this.listeners.clear();
  }
}

const eventHub = new PluginEventHub();

// ==========================================
// 插件命令调用包装器 (自适应短名与长名前缀兼容)
// ==========================================
async function invokePluginCmd(commandType: string, payload: any = {}): Promise<any> {
  if (!hostContext?.invokeCommand) {
    throw new Error('插件宿主接口未就绪，请稍后重试');
  }

  try {
    return await hostContext.invokeCommand(commandType, payload);
  } catch (firstErr: any) {
    // 尝试切换短名/长名前缀格式重试
    const altType = commandType.startsWith('class_mgr.')
      ? commandType.replace('class_mgr.', '')
      : `class_mgr.${commandType}`;
    try {
      return await hostContext.invokeCommand(altType, payload);
    } catch (_) {
      throw firstErr;
    }
  }
}

// ==========================================
// 1. 教师端侧边栏主面板 (teacher.tab)
// ==========================================
function TeacherTabPanel() {
  const [classes, setClasses] = React.useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = React.useState<string>('');
  const [students, setStudents] = React.useState<any[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = React.useState<Set<string>>(new Set());
  const [loading, setLoading] = React.useState<boolean>(false);
  const [newClassName, setNewClassName] = React.useState<string>('');
  const [isCreatingClass, setIsCreatingClass] = React.useState<boolean>(false);
  const [groupCount, setGroupCount] = React.useState<number>(4);
  const [newStudentNo, setNewStudentNo] = React.useState<string>('');
  const [newStudentName, setNewStudentName] = React.useState<string>('');

  const loadClasses = React.useCallback(async () => {
    try {
      setLoading(true);
      const res = await invokePluginCmd('class_mgr.class_list');
      const list = Array.isArray(res) ? res : res?.classes || [];
      setClasses(list);
      if (list.length > 0 && (!selectedClassId || !list.some((c: any) => c.id === selectedClassId))) {
        setSelectedClassId(list[0].id);
      }
    } catch (err: any) {
      console.error('[class-manager] 加载班级失败:', err);
      hostContext?.services?.uiService?.showToast?.('加载班级失败', err.message || String(err), 'warning');
    } finally {
      setLoading(false);
    }
  }, [selectedClassId]);

  const loadStudents = React.useCallback(async (classId: string) => {
    if (!classId) return;
    try {
      setLoading(true);
      const res = await invokePluginCmd('class_mgr.student_list', { classId });
      const list = Array.isArray(res) ? res : res?.students || [];
      setStudents(list);
    } catch (err: any) {
      console.error('[class-manager] 加载学生失败:', err);
      hostContext?.services?.uiService?.showToast?.('加载学生失败', err.message || String(err), 'warning');
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadClasses();
  }, []);

  React.useEffect(() => {
    if (selectedClassId) {
      loadStudents(selectedClassId);
    }
  }, [selectedClassId, loadStudents]);

  // WebSocket 实时同步监听
  React.useEffect(() => {
    const unsubPoints = eventHub.on('points_changed', (payload: any) => {
      setStudents((prev) =>
        prev.map((stu) => (stu.id === payload.studentId ? { ...stu, points: payload.currentPoints } : stu))
      );
    });

    const unsubGroups = eventHub.on('groups_updated', (payload: any) => {
      if (payload.classId === selectedClassId) {
        loadStudents(selectedClassId);
      }
    });

    const unsubImport = eventHub.on('students_imported', (payload: any) => {
      if (payload.classId === selectedClassId) {
        loadStudents(selectedClassId);
        loadClasses();
      }
    });

    const unsubClass = eventHub.on('class_created', () => {
      loadClasses();
    });

    return () => {
      unsubPoints();
      unsubGroups();
      unsubImport();
      unsubClass();
    };
  }, [selectedClassId, loadStudents, loadClasses]);

  const handleCreateClass = async () => {
    const name = newClassName.trim();
    if (!name) {
      hostContext?.services?.uiService?.showToast?.('提示', '请输入新班级名称后再点击创建', 'info');
      return;
    }
    setIsCreatingClass(true);
    try {
      const res = await invokePluginCmd('class_mgr.class_create', { name });
      setNewClassName('');
      hostContext?.services?.uiService?.showToast?.('成功', `班级「${name}」创建成功`, 'success');
      await loadClasses();
      if (res?.id) {
        setSelectedClassId(res.id);
      }
    } catch (err: any) {
      console.error('[class-manager] 新建班级失败:', err);
      hostContext?.services?.uiService?.showToast?.('创建失败', err.message || String(err), 'warning');
    } finally {
      setIsCreatingClass(false);
    }
  };

  const handleAddStudent = async () => {
    if (!selectedClassId) {
      hostContext?.services?.uiService?.showToast?.('提示', '请先选择或新建一个班级', 'info');
      return;
    }
    const name = newStudentName.trim();
    if (!name) {
      hostContext?.services?.uiService?.showToast?.('提示', '请输入学生姓名', 'info');
      return;
    }
    try {
      const studentNo = newStudentNo.trim() || `S-${Date.now().toString().slice(-6)}`;
      await invokePluginCmd('class_mgr.student_batch_import', {
        classId: selectedClassId,
        students: [{ studentNo, name, gender: 'other' }],
      });
      setNewStudentNo('');
      setNewStudentName('');
      hostContext?.services?.uiService?.showToast?.('添加成功', `已添加学生「${name}」`, 'success');
      loadStudents(selectedClassId);
      loadClasses();
    } catch (err: any) {
      hostContext?.services?.uiService?.showToast?.('添加失败', err.message || String(err), 'warning');
    }
  };

  const handleUpdatePoints = async (studentId: string, delta: number) => {
    // 1. 本地立即乐观更新 UI 积分数字
    setStudents((prev) =>
      prev.map((stu) => (stu.id === studentId ? { ...stu, points: (stu.points || 0) + delta } : stu))
    );

    try {
      const res = await invokePluginCmd('class_mgr.student_update_points', {
        studentId,
        delta,
        reason: delta > 0 ? '课堂精彩发言' : '提醒专注',
      });
      // 2. 用服务端返回的精确积分校准
      if (res && typeof res.points === 'number') {
        setStudents((prev) =>
          prev.map((stu) => (stu.id === studentId ? { ...stu, points: res.points } : stu))
        );
      }
      const studentName = res?.name || students.find((s) => s.id === studentId)?.name || '学生';
      hostContext?.services?.uiService?.showToast?.(
        '积分已变动',
        `${studentName} 积分 ${delta >= 0 ? '+' : ''}${delta} (当前: ${res?.points ?? '已更新'})`,
        'success'
      );
    } catch (err: any) {
      // 3. 失败时回滚
      setStudents((prev) =>
        prev.map((stu) => (stu.id === studentId ? { ...stu, points: (stu.points || 0) - delta } : stu))
      );
      console.error('[class-manager] 积分更新失败:', err);
      hostContext?.services?.uiService?.showToast?.('积分更新失败', err.message || String(err), 'warning');
    }
  };

  const handleAutoGroup = async () => {
    if (!selectedClassId) {
      hostContext?.services?.uiService?.showToast?.('提示', '请先选择班级', 'info');
      return;
    }
    try {
      await invokePluginCmd('class_mgr.group_generate', {
        classId: selectedClassId,
        groupCount,
      });
      hostContext?.services?.uiService?.showToast?.('分组成功', `已完成 ${groupCount} 组智能划分`, 'success');
      loadStudents(selectedClassId);
    } catch (err: any) {
      hostContext?.services?.uiService?.showToast?.('分组失败', err.message || String(err), 'warning');
    }
  };

  const toggleSelectStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedStudentIds.size === students.length && students.length > 0) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(students.map((s) => s.id)));
    }
  };

  const handleBatchPoints = async (delta: number) => {
    const ids = Array.from(selectedStudentIds);
    if (ids.length === 0) {
      hostContext?.services?.uiService?.showToast?.('提示', '请先勾选需要加减分的学生', 'info');
      return;
    }

    // 乐观更新
    setStudents((prev) =>
      prev.map((stu) => (selectedStudentIds.has(stu.id) ? { ...stu, points: (stu.points || 0) + delta } : stu))
    );

    try {
      await invokePluginCmd('class_mgr.student_batch_update_points', {
        studentIds: ids,
        delta,
        reason: '侧边栏批量奖惩',
      });
      hostContext?.services?.uiService?.showToast?.(
        '批量更新成功',
        `已为选中的 ${ids.length} 名学生统一 ${delta >= 0 ? '+' : ''}${delta} 分`,
        'success'
      );
      setSelectedStudentIds(new Set());
    } catch (err: any) {
      setStudents((prev) =>
        prev.map((stu) => (selectedStudentIds.has(stu.id) ? { ...stu, points: (stu.points || 0) - delta } : stu))
      );
      hostContext?.services?.uiService?.showToast?.('批量操作失败', err.message || String(err), 'warning');
    }
  };

  const handleSyncToHost = async () => {
    try {
      const res = await invokePluginCmd('class_mgr.sync_to_host');
      hostContext?.services?.uiService?.showToast?.('同步成功', res?.message || '已成功将班级和学生同步至宿主白板系统', 'success');
      loadClasses();
      if (selectedClassId) loadStudents(selectedClassId);
    } catch (err: any) {
      hostContext?.services?.uiService?.showToast?.('同步失败', err.message || String(err), 'warning');
    }
  };

  return (
    <div style={{ padding: '16px', fontFamily: 'system-ui, -apple-system, sans-serif', color: '#1f2937' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <h3 style={{ margin: 0, fontSize: '18px', fontWeight: 600 }}>👨‍🏫 班级与学生管理中心</h3>
        <span style={{ fontSize: '12px', color: '#059669', background: '#ecfdf5', padding: '2px 8px', borderRadius: 12 }}>
          ● 实时在线
        </span>
      </div>

      {/* 班级选择与新建 */}
      <div style={{ background: '#f9fafb', border: '1px solid #e5e7eb', borderRadius: 8, padding: 12, marginBottom: 16 }}>
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <label style={{ fontSize: 13, fontWeight: 500 }}>当前班级：</label>
          <select
            value={selectedClassId}
            onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedClassId(e.target.value)}
            style={{ padding: '6px 8px', borderRadius: 4, border: '1px solid #d1d5db', fontSize: 13 }}
          >
            {classes.length === 0 ? (
              <option value="">暂无班级（请在右侧新建）</option>
            ) : (
              classes.map((cls: any) => (
                <option key={cls.id} value={cls.id}>
                  {cls.source === 'host' ? '🏛️ ' : '✨ '}
                  {cls.name} ({cls.studentCount || 0}人)
                  {cls.source === 'host' ? ' [宿主系统]' : ''}
                </option>
              ))
            )}
          </select>

          <div style={{ display: 'flex', gap: 6, marginLeft: 'auto' }}>
            <input
              type="text"
              placeholder="新班级名称 (按回车创建)..."
              value={newClassName}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewClassName(e.target.value)}
              onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
                if (e.key === 'Enter') handleCreateClass();
              }}
              style={{ padding: '6px 10px', fontSize: 13, borderRadius: 4, border: '1px solid #d1d5db', minWidth: 160 }}
            />
            <button
              onClick={handleCreateClass}
              disabled={isCreatingClass}
              style={{
                padding: '6px 14px',
                fontSize: 13,
                background: isCreatingClass ? '#93c5fd' : '#2563eb',
                color: '#fff',
                border: 'none',
                borderRadius: 4,
                cursor: isCreatingClass ? 'not-allowed' : 'pointer',
                fontWeight: 600,
              }}
            >
              {isCreatingClass ? '创建中...' : '+ 新建班级'}
            </button>
          </div>
        </div>
      </div>

      {/* 快捷操作条 */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
          <input
            type="text"
            placeholder="学号(可选)"
            value={newStudentNo}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewStudentNo(e.target.value)}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 4, border: '1px solid #d1d5db', width: 90 }}
          />
          <input
            type="text"
            placeholder="学生姓名"
            value={newStudentName}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNewStudentName(e.target.value)}
            onKeyDown={(e: React.KeyboardEvent<HTMLInputElement>) => {
              if (e.key === 'Enter') handleAddStudent();
            }}
            style={{ padding: '6px 10px', fontSize: 13, borderRadius: 4, border: '1px solid #d1d5db', width: 110 }}
          />
          <button
            onClick={handleAddStudent}
            style={{ padding: '6px 12px', fontSize: 13, background: '#10b981', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            ＋ 添加学生
          </button>
        </div>
        <button
          onClick={handleSyncToHost}
          style={{ padding: '6px 12px', fontSize: 13, background: '#0284c7', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          title="强制将所有班级与学生同步至宿主白板系统"
        >
          🔄 同步白板数据
        </button>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            onClick={handleAutoGroup}
            style={{ padding: '6px 12px', fontSize: 13, background: '#8b5cf6', color: '#fff', border: 'none', borderRadius: 6, cursor: 'pointer' }}
          >
            ⚡ 智能均分
          </button>
          <input
            type="number"
            min={2}
            max={8}
            value={groupCount}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => setGroupCount(parseInt(e.target.value, 10) || 2)}
            style={{ width: 45, padding: '4px 6px', fontSize: 12, borderRadius: 4, border: '1px solid #d1d5db' }}
          />
          <span style={{ fontSize: 12, color: '#6b7280' }}>组</span>
        </div>

        {selectedStudentIds.size > 0 && (
          <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, background: '#eff6ff', padding: '4px 10px', borderRadius: 6, border: '1px solid #bfdbfe' }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: '#1e40af' }}>已选 {selectedStudentIds.size} 人：</span>
            <button
              onClick={() => handleBatchPoints(1)}
              style={{ padding: '3px 8px', fontSize: 11, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >
              +1分
            </button>
            <button
              onClick={() => handleBatchPoints(2)}
              style={{ padding: '3px 8px', fontSize: 11, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >
              +2分
            </button>
            <button
              onClick={() => handleBatchPoints(5)}
              style={{ padding: '3px 8px', fontSize: 11, background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >
              +5分
            </button>
            <button
              onClick={() => handleBatchPoints(-1)}
              style={{ padding: '3px 8px', fontSize: 11, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
            >
              -1分
            </button>
          </div>
        )}
      </div>

      {/* 学生花名册列表 */}
      <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, textAlign: 'left' }}>
          <thead style={{ background: '#f3f4f6', color: '#4b5563' }}>
            <tr>
              <th style={{ padding: '10px 12px', width: 36, textAlign: 'center' }}>
                <input
                  type="checkbox"
                  checked={selectedStudentIds.size === students.length && students.length > 0}
                  onChange={toggleSelectAll}
                  style={{ cursor: 'pointer' }}
                />
              </th>
              <th style={{ padding: '10px 12px' }}>学号</th>
              <th style={{ padding: '10px 12px' }}>姓名</th>
              <th style={{ padding: '10px 12px' }}>所属分组</th>
              <th style={{ padding: '10px 12px' }}>课堂积分</th>
              <th style={{ padding: '10px 12px', textAlign: 'center' }}>单个奖惩</th>
            </tr>
          </thead>
          <tbody>
            {students.length === 0 ? (
              <tr>
                <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: '#9ca3af' }}>
                  {loading ? '正在加载...' : '暂无学生，请先导入或添加'}
                </td>
              </tr>
            ) : (
              students.map((stu: any) => {
                const isSelected = selectedStudentIds.has(stu.id);
                return (
                  <tr
                    key={stu.id}
                    style={{
                      borderTop: '1px solid #f3f4f6',
                      background: isSelected ? '#f0fdf4' : 'transparent',
                    }}
                  >
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <input
                        type="checkbox"
                        checked={isSelected}
                        onChange={() => toggleSelectStudent(stu.id)}
                        style={{ cursor: 'pointer' }}
                      />
                    </td>
                    <td style={{ padding: '10px 12px', color: '#6b7280' }}>{stu.studentNo}</td>
                    <td style={{ padding: '10px 12px', fontWeight: 500 }}>{stu.name}</td>
                    <td style={{ padding: '10px 12px' }}>
                      <span style={{ padding: '2px 8px', borderRadius: 12, background: '#e0e7ff', color: '#4338ca', fontSize: 11 }}>
                        {stu.groupName || '未分组'}
                      </span>
                    </td>
                    <td style={{ padding: '10px 12px', fontWeight: 600, color: stu.points >= 0 ? '#059669' : '#dc2626' }}>
                      ⭐ {stu.points}
                    </td>
                    <td style={{ padding: '10px 12px', textAlign: 'center' }}>
                      <button
                        onClick={() => handleUpdatePoints(stu.id, 1)}
                        style={{ marginRight: 4, padding: '2px 8px', background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                      >
                        +1
                      </button>
                      <button
                        onClick={() => handleUpdatePoints(stu.id, 2)}
                        style={{ marginRight: 4, padding: '2px 8px', background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                      >
                        +2
                      </button>
                      <button
                        onClick={() => handleUpdatePoints(stu.id, -1)}
                        style={{ padding: '2px 8px', background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                      >
                        -1
                      </button>
                    </td>
                  </tr>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ==========================================
// 2. 课堂白板点名与学生加减分互动组件 (teacher.dashboard.widget)
// ==========================================
function ClassDashboardWidget() {
  const [activeTab, setActiveTab] = React.useState<'rollcall' | 'grid' | 'groups'>('grid');
  const [classes, setClasses] = React.useState<any[]>([]);
  const [selectedClassId, setSelectedClassId] = React.useState<string>('');
  const [students, setStudents] = React.useState<any[]>([]);
  const [groups, setGroups] = React.useState<any[]>([]);
  const [selectedStudentIds, setSelectedStudentIds] = React.useState<Set<string>>(new Set());
  const [pickedStudent, setPickedStudent] = React.useState<any>(null);
  const [isRolling, setIsRolling] = React.useState<boolean>(false);
  const [loading, setLoading] = React.useState<boolean>(false);

  const loadClasses = React.useCallback(async () => {
    try {
      const res = await invokePluginCmd('class_mgr.class_list');
      const list = Array.isArray(res) ? res : res?.classes || [];
      setClasses(list);
      if (list.length > 0 && !selectedClassId) {
        setSelectedClassId(list[0].id);
      }
    } catch (err) {
      console.error('[widget] 加载班级失败:', err);
    }
  }, [selectedClassId]);

  const loadClassData = React.useCallback(async (classId: string) => {
    if (!classId) return;
    try {
      setLoading(true);
      const [stuRes, grpRes] = await Promise.all([
        invokePluginCmd('class_mgr.student_list', { classId }),
        invokePluginCmd('class_mgr.group_list', { classId }),
      ]);
      setStudents(Array.isArray(stuRes) ? stuRes : stuRes?.students || []);
      setGroups(Array.isArray(grpRes) ? grpRes : []);
    } catch (err) {
      console.error('[widget] 加载数据失败:', err);
    } finally {
      setLoading(false);
    }
  }, []);

  React.useEffect(() => {
    loadClasses();
  }, [loadClasses]);

  React.useEffect(() => {
    if (selectedClassId) {
      loadClassData(selectedClassId);
      setSelectedStudentIds(new Set());
    }
  }, [selectedClassId, loadClassData]);

  // 监听 WebSocket 事件多端同步
  React.useEffect(() => {
    const unsubPick = eventHub.on('student_picked', (payload: any) => {
      setPickedStudent({
        studentId: payload.studentId,
        name: payload.studentName,
        studentNo: payload.studentNo,
        points: payload.points ?? 0,
      });
      setIsRolling(false);
    });

    const unsubPoints = eventHub.on('points_changed', (payload: any) => {
      setStudents((prev) =>
        prev.map((stu) => (stu.id === payload.studentId ? { ...stu, points: payload.currentPoints } : stu))
      );
      setPickedStudent((prev: any) => {
        if (prev && prev.studentId === payload.studentId) {
          return { ...prev, points: payload.currentPoints };
        }
        return prev;
      });
    });

    const unsubGroups = eventHub.on('groups_updated', (payload: any) => {
      if (payload.classId === selectedClassId) {
        loadClassData(selectedClassId);
      }
    });

    return () => {
      unsubPick();
      unsubPoints();
      unsubGroups();
    };
  }, [selectedClassId, loadClassData]);

  // 单个学生加减分
  const handleSinglePoint = async (studentId: string, delta: number) => {
    setStudents((prev) =>
      prev.map((stu) => (stu.id === studentId ? { ...stu, points: (stu.points || 0) + delta } : stu))
    );
    try {
      const res = await invokePluginCmd('class_mgr.student_update_points', {
        studentId,
        delta,
        reason: '白板即时加减分',
      });
      if (res && typeof res.points === 'number') {
        setStudents((prev) =>
          prev.map((stu) => (stu.id === studentId ? { ...stu, points: res.points } : stu))
        );
      }
      const stuName = students.find((s) => s.id === studentId)?.name || '学生';
      hostContext?.services?.uiService?.showToast?.(
        '积分已更新',
        `${stuName} ${delta >= 0 ? '+' : ''}${delta} 分 (当前: ${res?.points ?? '已更新'})`,
        'success'
      );
    } catch (err: any) {
      setStudents((prev) =>
        prev.map((stu) => (stu.id === studentId ? { ...stu, points: (stu.points || 0) - delta } : stu))
      );
      hostContext?.services?.uiService?.showToast?.('加分失败', err.message || String(err), 'warning');
    }
  };

  // 批量学生加减分
  const handleBatchPoints = async (delta: number) => {
    const ids = Array.from(selectedStudentIds);
    if (ids.length === 0) {
      hostContext?.services?.uiService?.showToast?.('提示', '请先勾选需要加减分的学生', 'info');
      return;
    }

    // 乐观更新
    setStudents((prev) =>
      prev.map((stu) => (selectedStudentIds.has(stu.id) ? { ...stu, points: (stu.points || 0) + delta } : stu))
    );

    try {
      const res = await invokePluginCmd('class_mgr.student_batch_update_points', {
        studentIds: ids,
        delta,
        reason: '白板课堂批量奖惩',
      });
      hostContext?.services?.uiService?.showToast?.(
        '批量奖励成功',
        `已为 ${ids.length} 名学生统一 ${delta >= 0 ? '+' : ''}${delta} 分`,
        'success'
      );
      setSelectedStudentIds(new Set());
    } catch (err: any) {
      // 失败回滚
      setStudents((prev) =>
        prev.map((stu) => (selectedStudentIds.has(stu.id) ? { ...stu, points: (stu.points || 0) - delta } : stu))
      );
      hostContext?.services?.uiService?.showToast?.('批量操作失败', err.message || String(err), 'warning');
    }
  };

  // 小组全员批量加分
  const handleGroupPoints = async (group: any, delta: number) => {
    const members = students.filter((s) => s.groupId === group.id || group.studentIds?.includes(s.id));
    if (members.length === 0) {
      hostContext?.services?.uiService?.showToast?.('提示', '该小组暂无学生成员', 'info');
      return;
    }
    const ids = members.map((m) => m.id);

    // 乐观更新
    setStudents((prev) =>
      prev.map((stu) => (ids.includes(stu.id) ? { ...stu, points: (stu.points || 0) + delta } : stu))
    );

    try {
      await invokePluginCmd('class_mgr.student_batch_update_points', {
        studentIds: ids,
        delta,
        reason: `${group.name} 团队协作奖励`,
      });
      hostContext?.services?.uiService?.showToast?.(
        '小组奖励成功',
        `已为「${group.name}」全组 ${members.length} 人统一 ${delta >= 0 ? '+' : ''}${delta} 分`,
        'success'
      );
    } catch (err: any) {
      setStudents((prev) =>
        prev.map((stu) => (ids.includes(stu.id) ? { ...stu, points: (stu.points || 0) - delta } : stu))
      );
      hostContext?.services?.uiService?.showToast?.('小组加分失败', err.message || String(err), 'warning');
    }
  };

  // 随机点名
  const handleRollCall = async () => {
    if (!selectedClassId || isRolling) return;
    setIsRolling(true);
    try {
      const res = await invokePluginCmd('class_mgr.rollcall_pick', {
        classId: selectedClassId,
        count: 1,
      });
      if (res?.picked?.length > 0) {
        setTimeout(() => {
          setPickedStudent(res.picked[0]);
          setIsRolling(false);
        }, 800);
      }
    } catch (err: any) {
      setIsRolling(false);
      hostContext?.services?.uiService?.showToast?.('点名失败', err.message || String(err), 'warning');
    }
  };

  const toggleSelectStudent = (id: string) => {
    setSelectedStudentIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (selectedStudentIds.size === students.length && students.length > 0) {
      setSelectedStudentIds(new Set());
    } else {
      setSelectedStudentIds(new Set(students.map((s) => s.id)));
    }
  };

  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        minHeight: 360,
        background: '#ffffff',
        padding: 8,
        fontFamily: 'system-ui, -apple-system, sans-serif',
        fontSize: 13,
        boxSizing: 'border-box',
        overflowY: 'auto',
      }}
    >
      {/* 头部：标题与班级切换 */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <h4 style={{ margin: 0, fontSize: 15, fontWeight: 700, color: '#1e40af', display: 'flex', alignItems: 'center', gap: 6 }}>
          ✨ 课堂互动与积分激励
        </h4>
        <select
          value={selectedClassId}
          onChange={(e: React.ChangeEvent<HTMLSelectElement>) => setSelectedClassId(e.target.value)}
          style={{ fontSize: 12, padding: '3px 6px', borderRadius: 4, border: '1px solid #d1d5db', maxWidth: 140 }}
        >
          {classes.map((cls: any) => (
            <option key={cls.id} value={cls.id}>
              {cls.source === 'host' ? '🏛️ ' : '✨ '}
              {cls.name}
            </option>
          ))}
        </select>
      </div>

      {/* 导航 Tab */}
      <div style={{ display: 'flex', background: '#f1f5f9', borderRadius: 8, padding: 3, marginBottom: 12 }}>
        <button
          onClick={() => setActiveTab('grid')}
          style={{
            flex: 1,
            padding: '5px 0',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            borderRadius: 6,
            background: activeTab === 'grid' ? '#ffffff' : 'transparent',
            color: activeTab === 'grid' ? '#2563eb' : '#64748b',
            boxShadow: activeTab === 'grid' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            cursor: 'pointer',
          }}
        >
          👥 学生花名册 (单个/批量)
        </button>
        <button
          onClick={() => setActiveTab('groups')}
          style={{
            flex: 1,
            padding: '5px 0',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            borderRadius: 6,
            background: activeTab === 'groups' ? '#ffffff' : 'transparent',
            color: activeTab === 'groups' ? '#2563eb' : '#64748b',
            boxShadow: activeTab === 'groups' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            cursor: 'pointer',
          }}
        >
          🏆 小组 PK 积分
        </button>
        <button
          onClick={() => setActiveTab('rollcall')}
          style={{
            flex: 1,
            padding: '5px 0',
            fontSize: 12,
            fontWeight: 600,
            border: 'none',
            borderRadius: 6,
            background: activeTab === 'rollcall' ? '#ffffff' : 'transparent',
            color: activeTab === 'rollcall' ? '#2563eb' : '#64748b',
            boxShadow: activeTab === 'rollcall' ? '0 1px 3px rgba(0,0,0,0.1)' : 'none',
            cursor: 'pointer',
          }}
        >
          🎲 随机抽问
        </button>
      </div>

      {/* 视图 1：👥 学生网格模式（支持单个加减分与批量多选加减分） */}
      {activeTab === 'grid' && (
        <div>
          {/* 工具栏：全选与计数 */}
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, padding: '0 2px' }}>
            <button
              onClick={toggleSelectAll}
              style={{
                fontSize: 11,
                padding: '2px 8px',
                background: '#e2e8f0',
                color: '#334155',
                border: 'none',
                borderRadius: 4,
                cursor: 'pointer',
              }}
            >
              {selectedStudentIds.size === students.length && students.length > 0 ? '取消全选' : '全选'}
            </button>
            <span style={{ fontSize: 11, color: '#64748b' }}>
              共 {students.length} 人 {selectedStudentIds.size > 0 && `(已选 ${selectedStudentIds.size} 人)`}
            </span>
          </div>

          {/* 学生卡片网格列表 */}
          <div
            style={{
              maxHeight: 240,
              overflowY: 'auto',
              display: 'grid',
              gridTemplateColumns: 'repeat(2, 1fr)',
              gap: 8,
              paddingRight: 2,
              marginBottom: selectedStudentIds.size > 0 ? 8 : 0,
            }}
          >
            {students.length === 0 ? (
              <div style={{ gridColumn: 'span 2', textAlign: 'center', padding: 24, color: '#94a3b8' }}>
                {loading ? '加载学生中...' : '当前班级暂无学生'}
              </div>
            ) : (
              students.map((stu) => {
                const isSelected = selectedStudentIds.has(stu.id);
                return (
                  <div
                    key={stu.id}
                    style={{
                      border: isSelected ? '1.5px solid #2563eb' : '1px solid #e2e8f0',
                      background: isSelected ? '#eff6ff' : '#f8fafc',
                      borderRadius: 8,
                      padding: '8px 10px',
                      display: 'flex',
                      flexDirection: 'column',
                      gap: 4,
                      position: 'relative',
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <div
                        onClick={() => toggleSelectStudent(stu.id)}
                        style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', flex: 1 }}
                      >
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          style={{ cursor: 'pointer', pointerEvents: 'none' }}
                        />
                        <span style={{ fontWeight: 600, color: '#0f172a', fontSize: 13 }}>{stu.name}</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: stu.points >= 0 ? '#16a34a' : '#dc2626' }}>
                        ⭐ {stu.points || 0}
                      </span>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 2 }}>
                      <span style={{ fontSize: 10, color: '#64748b' }}>{stu.studentNo}</span>
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          onClick={() => handleSinglePoint(stu.id, 1)}
                          style={{ padding: '1px 5px', fontSize: 11, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}
                          title="加1分"
                        >
                          +1
                        </button>
                        <button
                          onClick={() => handleSinglePoint(stu.id, 2)}
                          style={{ padding: '1px 5px', fontSize: 11, background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}
                          title="加2分"
                        >
                          +2
                        </button>
                        <button
                          onClick={() => handleSinglePoint(stu.id, -1)}
                          style={{ padding: '1px 5px', fontSize: 11, background: '#fee2e2', color: '#b91c1c', border: '1px solid #fca5a5', borderRadius: 3, cursor: 'pointer', fontWeight: 600 }}
                          title="减1分"
                        >
                          -1
                        </button>
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* 批量操作工具条 (勾选学生后显示) */}
          {selectedStudentIds.size > 0 && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#1e40af',
                color: '#ffffff',
                borderRadius: 8,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span style={{ fontSize: 12, fontWeight: 600 }}>批量奖励 ({selectedStudentIds.size}人)：</span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button
                  onClick={() => handleBatchPoints(1)}
                  style={{ padding: '3px 8px', fontSize: 11, background: '#22c55e', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                >
                  +1分
                </button>
                <button
                  onClick={() => handleBatchPoints(2)}
                  style={{ padding: '3px 8px', fontSize: 11, background: '#3b82f6', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                >
                  +2分
                </button>
                <button
                  onClick={() => handleBatchPoints(5)}
                  style={{ padding: '3px 8px', fontSize: 11, background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                >
                  +5分
                </button>
                <button
                  onClick={() => handleBatchPoints(-1)}
                  style={{ padding: '3px 8px', fontSize: 11, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                >
                  -1分
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* 视图 2：🏆 小组 PK 积分模式 */}
      {activeTab === 'groups' && (
        <div style={{ maxHeight: 270, overflowY: 'auto' }}>
          {groups.length === 0 ? (
            <div style={{ textAlign: 'center', padding: 24, color: '#94a3b8' }}>
              当前班级尚未分组，请在管理面板中执行「智能均分」
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {groups.map((grp) => {
                const members = students.filter((s) => s.groupId === grp.id || grp.studentIds?.includes(s.id));
                const totalPoints = members.reduce((sum, s) => sum + (s.points || 0), 0);
                return (
                  <div
                    key={grp.id}
                    style={{
                      border: '1px solid #e2e8f0',
                      background: '#f8fafc',
                      borderRadius: 8,
                      padding: '10px 12px',
                    }}
                  >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ width: 10, height: 10, borderRadius: '50%', background: grp.color || '#2563eb' }} />
                        <span style={{ fontWeight: 700, color: '#1e293b' }}>{grp.name}</span>
                        <span style={{ fontSize: 11, color: '#64748b' }}>({members.length}人)</span>
                      </div>
                      <span style={{ fontSize: 12, fontWeight: 700, color: '#d97706' }}>
                        组总分: ⭐ {totalPoints}
                      </span>
                    </div>

                    <div style={{ fontSize: 11, color: '#64748b', marginBottom: 8, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      组员: {members.map((m) => m.name).join('、') || '暂无成员'}
                    </div>

                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        onClick={() => handleGroupPoints(grp, 1)}
                        style={{ padding: '3px 8px', fontSize: 11, background: '#dcfce7', color: '#15803d', border: '1px solid #86efac', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                      >
                        全组 +1
                      </button>
                      <button
                        onClick={() => handleGroupPoints(grp, 2)}
                        style={{ padding: '3px 8px', fontSize: 11, background: '#dbeafe', color: '#1d4ed8', border: '1px solid #93c5fd', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                      >
                        全组 +2
                      </button>
                      <button
                        onClick={() => handleGroupPoints(grp, 5)}
                        style={{ padding: '3px 8px', fontSize: 11, background: '#fef3c7', color: '#b45309', border: '1px solid #fde68a', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
                      >
                        全组 +5
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* 视图 3：🎲 随机抽问模式 */}
      {activeTab === 'rollcall' && (
        <div>
          <div
            style={{
              background: '#eff6ff',
              borderRadius: 8,
              padding: '24px 12px',
              textAlign: 'center',
              marginBottom: 10,
              minHeight: 80,
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: 'center',
            }}
          >
            {isRolling ? (
              <div style={{ fontSize: 20, fontWeight: 700, color: '#2563eb' }}>
                🎲 正在抽取中...
              </div>
            ) : pickedStudent ? (
              <div>
                <div style={{ fontSize: 24, fontWeight: 800, color: '#1e3a8a' }}>{pickedStudent.name}</div>
                <div style={{ fontSize: 12, color: '#6b7280', marginTop: 4 }}>
                  学号: {pickedStudent.studentNo} | 当前积分: ⭐ {pickedStudent.points}
                </div>
              </div>
            ) : (
              <div style={{ fontSize: 13, color: '#9ca3af' }}>点击下方按钮或 AI 助教唤起点名</div>
            )}
          </div>

          <button
            onClick={handleRollCall}
            disabled={isRolling}
            style={{
              width: '100%',
              padding: '10px 0',
              background: '#2563eb',
              color: '#fff',
              border: 'none',
              borderRadius: 6,
              fontWeight: 600,
              cursor: isRolling ? 'not-allowed' : 'pointer',
              marginBottom: 8,
            }}
          >
            {isRolling ? '抽取中...' : '🎲 随机抽取 1 名学生'}
          </button>

          {pickedStudent && (
            <div style={{ display: 'flex', gap: 6, justifyContent: 'center' }}>
              <button
                onClick={() => handleSinglePoint(pickedStudent.studentId, 2)}
                style={{ padding: '5px 12px', fontSize: 12, background: '#10b981', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
              >
                👏 精彩发言 (+2)
              </button>
              <button
                onClick={() => handleSinglePoint(pickedStudent.studentId, 5)}
                style={{ padding: '5px 12px', fontSize: 12, background: '#f59e0b', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
              >
                🏆 完美答题 (+5)
              </button>
              <button
                onClick={() => handleSinglePoint(pickedStudent.studentId, -1)}
                style={{ padding: '5px 12px', fontSize: 12, background: '#ef4444', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer', fontWeight: 600 }}
              >
                ⚠️ 提醒专注 (-1)
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ==========================================
// 3. 教师全景全宽面板 (teacher.panel)
// ==========================================
function TeacherFullPanel() {
  const [classes, setClasses] = React.useState<any[]>([]);
  const [selectedClass, setSelectedClass] = React.useState<any>(null);
  const [summary, setSummary] = React.useState<any>(null);

  const reloadSummary = React.useCallback(() => {
    if (selectedClass?.id) {
      invokePluginCmd('class_mgr.class_summary', { classId: selectedClass.id }).then(setSummary).catch((e) => console.error('[panel] summary error:', e));
    }
  }, [selectedClass]);

  React.useEffect(() => {
    invokePluginCmd('class_mgr.class_list').then((res: any[]) => {
      const list = Array.isArray(res) ? res : (res as any)?.classes || [];
      setClasses(list);
      if (list.length > 0) {
        setSelectedClass(list[0]);
      }
    }).catch((e) => console.error('[panel] class_list error:', e));
  }, []);

  React.useEffect(() => {
    reloadSummary();
  }, [reloadSummary]);

  // 监听 WebSocket 事件自动无刷新重算大屏指标
  React.useEffect(() => {
    const unsubAtt = eventHub.on('attendance_saved', () => reloadSummary());
    const unsubPts = eventHub.on('points_changed', () => reloadSummary());
    const unsubGrp = eventHub.on('groups_updated', () => reloadSummary());

    return () => {
      unsubAtt();
      unsubPts();
      unsubGrp();
    };
  }, [reloadSummary]);

  return (
    <div style={{ padding: 24, background: '#f8fafc', minHeight: '100%', fontFamily: 'system-ui, sans-serif' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ fontSize: 22, fontWeight: 700, color: '#0f172a', margin: 0 }}>📊 班级全景学情与管理大屏</h2>
        <span style={{ fontSize: 12, color: '#0284c7', background: '#e0f2fe', padding: '4px 10px', borderRadius: 12, fontWeight: 500 }}>
          ⚡ 实时数据流已连接
        </span>
      </div>

      {/* 班级切换 */}
      <div style={{ display: 'flex', gap: 12, marginBottom: 24 }}>
        {classes.map((cls: any) => (
          <div
            key={cls.id}
            onClick={() => setSelectedClass(cls)}
            style={{
              padding: '12px 20px',
              borderRadius: 8,
              background: selectedClass?.id === cls.id ? '#2563eb' : '#ffffff',
              color: selectedClass?.id === cls.id ? '#ffffff' : '#334155',
              boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
              cursor: 'pointer',
              fontWeight: 600,
            }}
          >
            {cls.source === 'host' ? '🏛️ ' : '✨ '}
            {cls.name} ({cls.studentCount || 0}人)
          </div>
        ))}
      </div>

      {/* 数据概览卡片 */}
      {summary && (
        <>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 16, marginBottom: 24 }}>
            <div style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>班级总人数</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#1e293b', marginTop: 4 }}>{summary.totalStudents} 人</div>
            </div>
            <div style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>协作小组</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#8b5cf6', marginTop: 4 }}>{summary.totalGroups} 组</div>
            </div>
            <div style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>加权出勤率</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: summary.attendanceRate >= 90 ? '#10b981' : '#f59e0b', marginTop: 4 }}>
                {summary.attendanceRate}%
              </div>
            </div>
            <div style={{ background: '#fff', padding: 16, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: 13, color: '#64748b' }}>平均课堂积分</div>
              <div style={{ fontSize: 26, fontWeight: 700, color: '#0ea5e9', marginTop: 4 }}>
                ⭐ {summary.pointsStats?.avgPoints ?? 0}
              </div>
            </div>
          </div>

          {/* 考勤聚合与积分详情 */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
            <div style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#1e293b' }}>📋 考勤实况聚合统计</h4>
              <div style={{ fontSize: 13, color: '#64748b', marginBottom: 12 }}>
                累计记录：{summary.attendanceStats?.totalRecords || 0} 人次
              </div>
              <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
                <div style={{ padding: '8px 16px', background: '#dcfce7', borderRadius: 6, color: '#15803d', fontSize: 13, fontWeight: 600 }}>
                  准时: {summary.attendanceStats?.presentCount || 0}
                </div>
                <div style={{ padding: '8px 16px', background: '#fef3c7', borderRadius: 6, color: '#b45309', fontSize: 13, fontWeight: 600 }}>
                  迟到: {summary.attendanceStats?.lateCount || 0}
                </div>
                <div style={{ padding: '8px 16px', background: '#e0e7ff', borderRadius: 6, color: '#4338ca', fontSize: 13, fontWeight: 600 }}>
                  请假: {summary.attendanceStats?.leaveCount || 0}
                </div>
                <div style={{ padding: '8px 16px', background: '#fee2e2', borderRadius: 6, color: '#b91c1c', fontSize: 13, fontWeight: 600 }}>
                  旷课: {summary.attendanceStats?.absentCount || 0}
                </div>
              </div>
            </div>

            <div style={{ background: '#fff', padding: 20, borderRadius: 8, border: '1px solid #e2e8f0' }}>
              <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#1e293b' }}>🏆 课堂积分风云榜 (Top 5)</h4>
              {summary.topActiveStudents?.length > 0 ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {summary.topActiveStudents.map((s: any, idx: number) => (
                    <div key={idx} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, padding: '4px 0', borderBottom: '1px solid #f1f5f9' }}>
                      <span>#{idx + 1} {s.name}</span>
                      <span style={{ fontWeight: 600, color: '#f59e0b' }}>⭐ {s.points} 分</span>
                    </div>
                  ))}
                </div>
              ) : (
                <div style={{ fontSize: 13, color: '#94a3b8' }}>暂无积分记录</div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ==========================================
// 4. 学生端视图 (student.view)
// ==========================================
function StudentViewPanel(props: any) {
  // student.view 宿主会注入当前学生身份 { studentId }；未注入时无法归属个人数据，展示中性占位
  const myStudentId = props?.studentId;
  const [personalPoints, setPersonalPoints] = React.useState<number>(0);
  const [calledAlert, setCalledAlert] = React.useState<string | null>(null);

  // 监听学生端被点名与积分奖励事件（仅处理属于当前学生本人的事件）
  React.useEffect(() => {
    const isMine = (payload: any) => {
      if (!myStudentId) return false; // 无身份上下文时不展示个人化提醒
      if (!payload?.studentId) return false;
      return payload.studentId === myStudentId;
    };

    const unsubPick = eventHub.on('student_picked', (payload: any) => {
      if (!isMine(payload)) return;
      setCalledAlert(`🔔 老师抽选了你回答问题: ${payload.studentName || ''}`);
      setTimeout(() => setCalledAlert(null), 5000);
    });

    const unsubPoints = eventHub.on('points_changed', (payload: any) => {
      if (!isMine(payload)) return;
      setPersonalPoints(payload.currentPoints || 0);
      hostContext?.services?.uiService?.showToast?.(
        '⭐ 积分变动提醒',
        `恭喜！你刚刚获得了 ${payload.delta >= 0 ? '+' : ''}${payload.delta} 积分`,
        'success'
      );
    });

    return () => {
      unsubPick();
      unsubPoints();
    };
  }, [myStudentId]);

  return (
    <div style={{ padding: 20, fontFamily: 'system-ui, sans-serif' }}>
      {calledAlert && (
        <div
          style={{
            background: '#fef3c7',
            border: '2px solid #f59e0b',
            color: '#92400e',
            borderRadius: 8,
            padding: 12,
            marginBottom: 16,
            fontWeight: 700,
            fontSize: 15,
            textAlign: 'center',
          }}
        >
          {calledAlert}
        </div>
      )}

      <div style={{ background: 'linear-gradient(135deg, #6366f1 0%, #a855f7 100%)', borderRadius: 12, padding: 24, color: '#fff', marginBottom: 20 }}>
        <h3 style={{ margin: 0, fontSize: 20 }}>🌟 我的课堂档案</h3>
        <p style={{ margin: '8px 0 0 0', opacity: 0.9, fontSize: 14 }}>实时掌握个人课堂积分与考勤表现</p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#374151' }}>🎯 我的积分徽章</h4>
          <div style={{ fontSize: 28, fontWeight: 800, color: '#f59e0b' }}>⭐ {myStudentId ? personalPoints : '—'} 积分</div>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>
            {myStudentId ? 'WebSocket 实时同步最新课堂加分' : '登录学生端后可查看个人实时积分'}
          </p>
        </div>

        <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
          <h4 style={{ margin: '0 0 12px 0', fontSize: 15, color: '#374151' }}>📅 考勤记录</h4>
          <div style={{ fontSize: 22, fontWeight: 800, color: '#64748b' }}>暂无考勤数据</div>
          <p style={{ fontSize: 12, color: '#6b7280', marginTop: 8 }}>教师录入考勤后此处将实时展示</p>
        </div>
      </div>
    </div>
  );
}

// ==========================================
// 插件生命周期管理与 Disposable 资源精确卸载
// ==========================================
const disposables: Array<() => void> = [];

function registerDisposable(cleanupFn: () => void) {
  disposables.push(cleanupFn);
}

async function activate(hostCtx: any) {
  hostContext = hostCtx;

  const registerExtension = (slot: string, config: any) => {
    hostCtx.ui.registerExtensionPoint(slot, config);
    registerDisposable(() => {
      try {
        hostCtx.ui.unregisterExtensionPoint(slot, config.id);
      } catch (err) {
        console.warn(`[@openlearn/class-manager] 卸载扩展槽位 ${slot}:${config.id} 异常:`, err);
      }
    });
  };

  // 1. 注册教师侧边栏管理页
  registerExtension('teacher.tab', {
    id: 'class-mgr-teacher-tab',
    label: '班级管理',
    icon: 'Users',
    component: TeacherTabPanel,
    position: 10,
  });

  // 2. 注册教师全景大屏面板
  registerExtension('teacher.panel', {
    id: 'class-mgr-full-panel',
    label: '班级看板',
    icon: 'LayoutGrid',
    component: TeacherFullPanel,
    position: 11,
  });

  // 3. 注册课堂白板可拖拽组件（支持多别名与多 ID 匹配）
  // 规范 ID 为 class-mgr-widget（与 manifest.classroomTools payload 的 teacherWidgetId 一致）；
  // 保留 class-mgr-tool 别名以兼容按工具 ID 寻址的宿主实现，避免重复挂件
  const widgetIds = ['class-mgr-widget', 'class-mgr-tool'];
  widgetIds.forEach((id) => {
    registerExtension('teacher.dashboard.widget', {
      id,
      label: '课堂加分与点名',
      icon: 'Award',
      component: ClassDashboardWidget,
    });
  });

  // 3b. 注册课堂白板工具栏按钮 (classroom.tool)
  registerExtension('classroom.tool', {
    id: 'class-mgr-tool',
    label: '课堂加分',
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
  });

  // 3c. 全局白板常驻即时加分悬浮窗（保证即使不在画布内插入卡片，老师随时在屏幕上点击加分）
  // 仅教师角色注入：学生端不出现教师操作按钮
  const role = (hostCtx as any)?.user?.role || (hostCtx as any)?.auth?.role || (hostCtx as any)?.role;
  const isStudentRole = role === 'student' || role === 'learner';
  if (isStudentRole) {
    console.debug('[@openlearn/class-manager] 学生角色，跳过教师悬浮加分挂件注入');
  } else {
    try {
    if (typeof document !== 'undefined') {
      const containerId = 'openlearn-class-mgr-floating-root';
      let container = document.getElementById(containerId);
      if (!container) {
        container = document.createElement('div');
        container.id = containerId;
        document.body.appendChild(container);
      }

      const FloatingTrigger = () => {
        const [isOpen, setIsOpen] = React.useState(false);

        React.useEffect(() => {
          const unsub = eventHub.on('open_floating_widget', () => {
            setIsOpen(true);
          });
          const handleCustomEvt = () => setIsOpen(true);
          window.addEventListener('class_mgr_open_floating', handleCustomEvt);
          return () => {
            unsub();
            window.removeEventListener('class_mgr_open_floating', handleCustomEvt);
          };
        }, []);

        return (
          <div
            style={{
              position: 'fixed',
              right: 20,
              bottom: 76,
              zIndex: 99999,
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'flex-end',
              gap: 8,
              fontFamily: 'system-ui, sans-serif',
            }}
          >
            {isOpen && (
              <div
                style={{
                  background: '#ffffff',
                  borderRadius: 12,
                  boxShadow: '0 20px 40px -4px rgba(0,0,0,0.25)',
                  border: '2px solid #2563eb',
                  overflow: 'hidden',
                  maxHeight: '85vh',
                }}
              >
                <div
                  style={{
                    background: '#1e40af',
                    color: '#ffffff',
                    padding: '8px 12px',
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                  }}
                >
                  <span style={{ fontSize: 13, fontWeight: 700 }}>⚡ 白板课堂即时加分小部件</span>
                  <button
                    onClick={() => setIsOpen(false)}
                    style={{
                      background: 'none',
                      border: 'none',
                      color: '#ffffff',
                      fontSize: 18,
                      fontWeight: 700,
                      cursor: 'pointer',
                      padding: '0 4px',
                    }}
                    title="收起加分挂件"
                  >
                    ×
                  </button>
                </div>
                <div style={{ padding: 6 }}>
                  <ClassDashboardWidget />
                </div>
              </div>
            )}

            <button
              onClick={() => setIsOpen((prev) => !prev)}
              style={{
                background: isOpen ? '#1e40af' : 'linear-gradient(135deg, #2563eb, #7c3aed)',
                color: '#ffffff',
                border: 'none',
                borderRadius: 24,
                padding: '10px 18px',
                fontSize: 13,
                fontWeight: 700,
                boxShadow: '0 4px 15px rgba(37,99,235,0.4)',
                cursor: 'pointer',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                transition: 'all 0.2s',
              }}
              title="点击打开/收起课堂加分小部件"
            >
              {isOpen ? '收起加分' : '⚡ 课堂加分'}
            </button>
          </div>
        );
      };

      const ReactDOMObj = (window as any).HostSharedDeps?.ReactDOM || (window as any).ReactDOM || ReactDOM;
      if (ReactDOMObj?.createRoot) {
        const root = ReactDOMObj.createRoot(container);
        root.render(React.createElement(FloatingTrigger));
        registerDisposable(() => {
          try {
            root.unmount();
            container?.remove();
          } catch (_) {}
        });
      } else if (ReactDOMObj?.render) {
        ReactDOMObj.render(React.createElement(FloatingTrigger), container);
        registerDisposable(() => {
          try {
            ReactDOMObj.unmountComponentAtNode(container!);
            container?.remove();
          } catch (_) {}
        });
      }
    }
  } catch (err) {
    console.warn('[@openlearn/class-manager] 注入全局悬浮加分挂件异常:', err);
  }
  }

  // 4. 注册学生端视图
  registerExtension('student.view', {
    id: 'class-mgr-student-view',
    label: '我的档案',
    component: StudentViewPanel,
  });

  // 5. 挂载宿主 WebSocket 事件监听并分发到 PluginEventHub
  const socketService = hostCtx?.services?.socketService;
  if (socketService && typeof socketService.on === 'function') {
    const events = [
      'class_mgr.points_changed',
      'class_mgr.student_picked',
      'class_mgr.attendance_saved',
      'class_mgr.groups_updated',
      'class_mgr.students_imported',
      'class_mgr.class_created',
      'class_mgr.open_floating_widget',
    ];

    events.forEach((evtName) => {
      const shortName = evtName.replace('class_mgr.', '');
      const handler = (evtData: any) => {
        const payload = evtData?.payload ?? evtData;
        eventHub.emit(shortName, payload);
      };

      socketService.on(evtName, handler);
      registerDisposable(() => {
        try {
          socketService.off(evtName, handler);
        } catch (_) {}
      });
    });
  }
}

function deactivate() {
  // 清空前端事件中心
  eventHub.clear();

  // 按照 LIFO 倒序执行所有资源的精确清理
  while (disposables.length > 0) {
    const cleanup = disposables.pop();
    if (cleanup) {
      try {
        cleanup();
      } catch (err) {
        console.warn('[@openlearn/class-manager] 清理资源时发生异常:', err);
      }
    }
  }

  hostContext = null;
}

export default { activate, deactivate };

