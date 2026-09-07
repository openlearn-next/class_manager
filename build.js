import esbuild from 'esbuild';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';

async function build() {
  console.log('🚀 开始构建 OpenLearn 班级与学生管理插件...');
  const distDir = path.resolve('dist');
  if (!fs.existsSync(distDir)) {
    fs.mkdirSync(distDir, { recursive: true });
  }

  // 1. 构建后端入口 index.js (完全自包含，无任何外部 import)
  console.log('📦 构建后端模块 (src/index.ts -> dist/index.js)...');
  await esbuild.build({
    entryPoints: ['src/index.ts'],
    bundle: true,
    outfile: 'dist/index.js',
    format: 'esm',
    platform: 'node',
    target: 'node20',
    external: [],
  });

  // 2. 构建前端模块 frontend.js
  console.log('🎨 构建前端模块 (src/frontend.tsx -> dist/frontend.js)...');
  await esbuild.build({
    entryPoints: ['src/frontend.tsx'],
    bundle: true,
    outfile: 'dist/frontend.js',
    format: 'esm',
    platform: 'browser',
    target: 'es2022',
    jsx: 'transform',
    jsxFactory: 'React.createElement',
    jsxFragment: 'React.Fragment',
    external: [],
  });

  // 3. 提取并生成 manifest.json
  console.log('📋 提取并生成 manifest.json...');
  const manifest = {
    id: '@ext/class-manager',
    name: '班级与学生管理增强',
    version: '0.3.12',
    main: 'index.js',
    description: '提供班级花名册导入、智能分组、互动白板课堂单个/批量加减分、小组PK激励、原子白板投射与真实学情聚合统计',
    author: 'OpenLearn',
    engines: { openlearn: '>=0.2.5' },
    requires: [
      '@openlearn/core:ICommandBusService@^1.0.0',
      '@openlearn/core:IActionRegistryService@^1.0.0',
      '@openlearn/core:IEventBusService@^1.0.0',
      '@openlearn/core:IDatabase@^1.0.0',
    ],
    pluginDependencies: ['@openlearn/plugin-management', '@openlearn/plugin-builtin'],
    capabilitiesProposed: ['lesson:read', 'lesson:write', 'whiteboard:write', 'management:read', 'management:write'],
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
  };
  fs.writeFileSync(path.join(distDir, 'manifest.json'), JSON.stringify(manifest, null, 2), 'utf-8');

  // 4. 打包为 ZIP 文件
  console.log('🗜️ 打包插件 ZIP (dist/openlearn-plugin-class-manager.zip)...');
  const zip = new JSZip();
  zip.file('index.js', fs.readFileSync(path.join(distDir, 'index.js')));
  zip.file('frontend.js', fs.readFileSync(path.join(distDir, 'frontend.js')));
  zip.file('manifest.json', fs.readFileSync(path.join(distDir, 'manifest.json')));

  const zipBuffer = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(distDir, 'openlearn-plugin-class-manager.zip'), zipBuffer);

  // 5. 安全扫描与自检
  console.log('🔍 执行安全规范自检...');
  const indexContent = fs.readFileSync(path.join(distDir, 'index.js'), 'utf-8');
  const allImports = indexContent.match(/^import\s+.*from\s+['"][^'"]*['"]/gm);
  if (allImports && allImports.length > 0) {
    console.error('❌ 警告：dist/index.js 中仍存在 import 语句（Worker 在 data: URL 下无法解析）：', allImports);
    process.exit(1);
  }

  const frontendContent = fs.readFileSync(path.join(distDir, 'frontend.js'), 'utf-8');
  if (frontendContent.includes('react/jsx-runtime')) {
    console.error('❌ 警告：前端产物中包含了 react/jsx-runtime 引用，请检查 JSX 模式！');
    process.exit(1);
  }

  console.log('✅ 构建成功！产物已生成在 dist/ 目录：');
  console.log('   - dist/index.js');
  console.log('   - dist/frontend.js');
  console.log('   - dist/manifest.json');
  console.log('   - dist/openlearn-plugin-class-manager.zip (可直接在 OpenLearn 后台上传安装)');
}

build().catch((err) => {
  console.error('❌ 构建失败：', err);
  process.exit(1);
});
