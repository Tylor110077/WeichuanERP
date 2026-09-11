/**
 * 侧边栏收起状态：存 Cookie（而非 localStorage），
 * 让服务端渲染时就能读到，刷新或表单 GET 跳转时直接渲染正确状态，避免「先展开再收起」的闪烁。
 *
 * 注意：该常量必须放在非 "use client" 模块中 —— 从客户端组件模块导入常量到服务端，
 * 拿到的是客户端引用而非字符串值，会导致服务端读到 undefined。
 */
export const SIDEBAR_COOKIE = "wc_sidebar_collapsed";
