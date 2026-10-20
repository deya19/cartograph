// The rail taxonomy lives apart from the adapters so a browser component can
// read category names without pulling a parser and a filesystem library into
// the bundle — this file imports nothing.
export type FileRole =
  | "page"
  | "route"
  | "server action"
  | "layout"
  | "component"
  | "hook"
  | "middleware"
  | "framework file"
  | "controller"
  | "resolver"
  | "gateway"
  | "service"
  | "repository"
  | "entity"
  | "dto"
  | "module"
  | "guard"
  | "interceptor"
  | "pipe"
  | "filter"
  | "model"
  | "config"
  | "test";

export type AdapterName = "nestjs" | "nextjs" | "express" | "react" | "fallback";

export type RouteMethod = "GET" | "HEAD" | "POST" | "PUT" | "DELETE" | "PATCH" | "OPTIONS" | "ALL" | "SEARCH" | "PAGE";

export const ROUTE_METHODS: readonly RouteMethod[] = [
  "GET",
  "HEAD",
  "POST",
  "PUT",
  "DELETE",
  "PATCH",
  "OPTIONS",
  "ALL",
  "SEARCH",
  "PAGE",
];

export const FILE_ROLES: readonly FileRole[] = [
  "page",
  "route",
  "server action",
  "layout",
  "component",
  "hook",
  "middleware",
  "framework file",
  "controller",
  "resolver",
  "gateway",
  "service",
  "repository",
  "entity",
  "dto",
  "module",
  "guard",
  "interceptor",
  "pipe",
  "filter",
  "model",
  "config",
  "test",
];

export type RoleCategory = { role: FileRole; label: string; reached: boolean };

// reached means the framework, config loader or test runner reaches the file,
// so zero importers isn't "unused". Order is fixed reading order: routable
// surfaces, then the layers behind them, then plumbing.
export const ROLE_CATEGORIES: Record<AdapterName, readonly RoleCategory[]> = {
  nextjs: [
    { role: "page", label: "Page routes", reached: true },
    { role: "route", label: "API endpoints", reached: true },
    { role: "server action", label: "Server actions", reached: false },
    { role: "layout", label: "Layouts", reached: true },
    { role: "component", label: "Components", reached: false },
    { role: "hook", label: "Hooks", reached: false },
    { role: "middleware", label: "Middleware", reached: true },
    { role: "framework file", label: "Framework files", reached: true },
    { role: "config", label: "Config", reached: true },
    { role: "test", label: "Tests", reached: true },
  ],
  nestjs: [
    { role: "controller", label: "Controllers", reached: false },
    { role: "resolver", label: "Resolvers", reached: false },
    { role: "gateway", label: "Gateways", reached: false },
    { role: "service", label: "Services", reached: false },
    { role: "repository", label: "Repositories", reached: false },
    { role: "entity", label: "Entities", reached: false },
    { role: "dto", label: "DTOs", reached: false },
    { role: "module", label: "Modules", reached: false },
    { role: "guard", label: "Guards", reached: false },
    { role: "interceptor", label: "Interceptors", reached: false },
    { role: "pipe", label: "Pipes", reached: false },
    { role: "filter", label: "Filters", reached: false },
    { role: "middleware", label: "Middleware", reached: false },
    { role: "config", label: "Config", reached: true },
    { role: "test", label: "Tests", reached: true },
  ],
  express: [
    { role: "route", label: "Routes", reached: false },
    { role: "controller", label: "Controllers", reached: false },
    { role: "middleware", label: "Middleware", reached: false },
    { role: "service", label: "Services", reached: false },
    { role: "model", label: "Models", reached: false },
    { role: "config", label: "Config", reached: true },
    { role: "test", label: "Tests", reached: true },
  ],
  react: [
    { role: "component", label: "Components", reached: false },
    { role: "hook", label: "Hooks", reached: false },
    { role: "config", label: "Config", reached: true },
    { role: "test", label: "Tests", reached: true },
  ],
  fallback: [
    { role: "config", label: "Config", reached: true },
    { role: "test", label: "Tests", reached: true },
  ],
};

function isAdapterName(name: string): name is AdapterName {
  return name === "nestjs" || name === "nextjs" || name === "express" || name === "react" || name === "fallback";
}

function categories(adapter: string): readonly RoleCategory[] {
  // Stored rows may name an adapter this build no longer ships; unknown names
  // get the generic list rather than a crash.
  return isAdapterName(adapter) ? ROLE_CATEGORIES[adapter] : ROLE_CATEGORIES.fallback;
}

export function categoriesFor(adapter: string): readonly RoleCategory[] {
  return categories(adapter);
}

export function reachedRoles(adapter: string): ReadonlySet<FileRole> {
  return new Set(categories(adapter).filter((category) => category.reached).map((category) => category.role));
}
