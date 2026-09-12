/**
 * 页面级加载骨架。
 *
 * 服务端组件在查询期间（大数据量时可能几百毫秒）会让用户面对"点了没反应"的空白，
 * 这里给一个与页面结构同形的骨架，Next 会在路由切换/数据加载时立即渲染它，
 * 让操作有即时反馈（感知性能）。纯静态、无 JS。
 */
export default function Loading() {
  return (
    <div className="animate-pulse space-y-6" aria-busy="true" aria-live="polite">
      {/* 标题行 */}
      <div className="flex items-center justify-between gap-3">
        <div className="h-6 w-40 rounded bg-gray-200" />
        <div className="h-9 w-28 rounded-md bg-gray-200" />
      </div>

      {/* 筛选条 */}
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gray-200 bg-white p-4">
        <div className="h-9 w-48 rounded-md bg-gray-100" />
        <div className="h-9 w-32 rounded-md bg-gray-100" />
        <div className="h-9 w-24 rounded-md bg-gray-100" />
      </div>

      {/* 表格 */}
      <div className="overflow-hidden rounded-xl border border-gray-200 bg-white">
        <div className="border-b border-gray-100 bg-gray-50 px-4 py-3">
          <div className="h-4 w-64 rounded bg-gray-200" />
        </div>
        {Array.from({ length: 8 }).map((_, i) => (
          <div key={i} className="flex items-center gap-6 border-b border-gray-50 px-4 py-3 last:border-0">
            <div className="h-4 w-28 rounded bg-gray-100" />
            <div className="h-4 w-40 rounded bg-gray-100" />
            <div className="h-4 w-20 rounded bg-gray-100" />
            <div className="ml-auto h-4 w-24 rounded bg-gray-100" />
          </div>
        ))}
      </div>

      <p className="text-center text-xs text-gray-400">正在加载…</p>
    </div>
  );
}
