import { describe, expect, it } from "vitest";
import {
  nameRenamer,
  planFeatureRename,
  planMovePath,
  planMoveToShared,
  type ProjectSources,
  type RefactorPlan,
} from "../../src/core/architecture/refactor";
import { addRoute } from "../../src/core/architecture/routes";
import { DEFAULT_MANIFEST } from "../../src/core/manifest/schema";
import { parseName, type NameForms } from "../../src/core/naming";
import { applyChanges } from "../../src/core/plan";
import { PACKAGE_MANAGERS } from "../../src/core/project/packageManager";
import { routesSource } from "../../src/core/templates/project";

const name = (input: string): NameForms => {
  const result = parseName(input);
  if (!result.ok) throw new Error(result.error);
  return result.name;
};

/** The project's files after applying a plan: changes first, then renames. */
function apply(
  sources: Record<string, string>,
  plan: RefactorPlan,
): Record<string, string> {
  let files = Object.entries(sources).map(([file, text]) => {
    const changes = plan.changes.get(file);
    return [file, changes ? applyChanges(text, changes) : text] as const;
  });
  for (const { from, to } of plan.renames) {
    files = files.map(([file, text]) =>
      file === from || file.startsWith(from + "/")
        ? [to + file.slice(from.length), text]
        : [file, text],
    );
  }
  return Object.fromEntries(files);
}

const project = (
  sources: Record<string, string>,
  folder: string,
  extra: string[] = [],
): ProjectSources => ({
  sources: new Map(Object.entries(sources)),
  filesInFolder: [
    ...Object.keys(sources).filter((file) => file.startsWith(folder + "/")),
    ...extra,
  ],
  manifest: DEFAULT_MANIFEST,
  aliases: [{ prefix: "@/", target: "src/", wildcard: true }],
});

describe("nameRenamer", () => {
  const rename = nameRenamer(name("user profile"), name("account"));
  it.each([
    ["UserProfile", "Account"],
    ["UserProfileProps", "AccountProps"],
    ["useUserProfile", "useAccount"],
    ["fetchUserProfile", "fetchAccount"],
    ["userProfileApi.ts", "accountApi.ts"],
    ["UserProfile.module.css", "Account.module.css"],
    ["UserProfiles", "UserProfiles"],
    ["XUserProfile", "XUserProfile"],
    ["components", "components"],
  ])("%s -> %s", (input, expected) => {
    expect(rename(input)).toBe(expected);
  });
});

describe("planFeatureRename", () => {
  const sources = {
    "src/features/user-profile/index.ts": [
      'export { UserProfile } from "./components/UserProfile/UserProfile";',
      'export { useUserProfile } from "./hooks/useUserProfile";',
      'export type { UserProfileData } from "./types";',
      "",
    ].join("\n"),
    "src/features/user-profile/components/UserProfile/UserProfile.tsx": [
      'import styles from "./UserProfile.module.css";',
      'import type { User } from "../../../../types/user";',
      'import { useUserProfile } from "../../hooks/useUserProfile";',
      "export interface UserProfileProps { user: User }",
      "export function UserProfile({ user }: UserProfileProps) {",
      "  const data = useUserProfile();",
      "  return <div className={styles.root}>UserProfile</div>;",
      "}",
      "",
    ].join("\n"),
    "src/features/user-profile/hooks/useUserProfile.ts":
      'import type { UserProfileData } from "../types";\nexport function useUserProfile(): UserProfileData { return {}; }\n',
    "src/features/user-profile/types.ts":
      "export interface UserProfileData {}\n",
    "src/app/routes.tsx": [
      'import { UserProfile } from "../features/user-profile";',
      'import { useUserProfile as useIt } from "@/features/user-profile";',
      "const page = <UserProfile />;",
      "",
    ].join("\n"),
    "src/app/reexport.ts":
      'export { UserProfile } from "../features/user-profile";\n',
    "src/types/user.ts": "export interface User {}\n",
  };

  const plan = planFeatureRename(
    project(sources, "src/features/user-profile", [
      "src/features/user-profile/components/UserProfile/UserProfile.module.css",
    ]),
    "src/features/user-profile",
    name("user profile"),
    name("account"),
  );
  const after = apply(sources, plan);

  it("renames the folder and the files named after the feature, deepest first", () => {
    expect(plan.renames).toEqual([
      {
        from: "src/features/user-profile/components/UserProfile/UserProfile.module.css",
        to: "src/features/user-profile/components/UserProfile/Account.module.css",
      },
      {
        from: "src/features/user-profile/components/UserProfile/UserProfile.tsx",
        to: "src/features/user-profile/components/UserProfile/Account.tsx",
      },
      {
        from: "src/features/user-profile/components/UserProfile",
        to: "src/features/user-profile/components/Account",
      },
      {
        from: "src/features/user-profile/hooks/useUserProfile.ts",
        to: "src/features/user-profile/hooks/useAccount.ts",
      },
      { from: "src/features/user-profile", to: "src/features/account" },
    ]);
  });

  it("updates imports and names inside the feature", () => {
    expect(after["src/features/account/index.ts"]).toBe(
      [
        'export { Account } from "./components/Account/Account";',
        'export { useAccount } from "./hooks/useAccount";',
        'export type { AccountData } from "./types";',
        "",
      ].join("\n"),
    );
    const component =
      after["src/features/account/components/Account/Account.tsx"]!;
    expect(component).toContain('import styles from "./Account.module.css";');
    expect(component).toContain(
      'import type { User } from "../../../../types/user";',
    );
    expect(component).toContain(
      "export function Account({ user }: AccountProps) {",
    );
    expect(component).toContain("const data = useAccount();");
    // Text inside JSX and strings is left alone.
    expect(component).toContain(">UserProfile</div>");
  });

  it("updates importers outside the feature, keeping aliases and re-exported names", () => {
    expect(after["src/app/routes.tsx"]).toBe(
      [
        'import { Account } from "../features/account";',
        'import { useAccount as useIt } from "@/features/account";',
        "const page = <Account />;",
        "",
      ].join("\n"),
    );
    expect(after["src/app/reexport.ts"]).toBe(
      'export { Account as UserProfile } from "../features/account";\n',
    );
    expect(plan.updatedImporters).toEqual([
      "src/app/reexport.ts",
      "src/app/routes.tsx",
    ]);
    expect(plan.renamedNames.get("UserProfileProps")).toBe("AccountProps");
    expect(plan.renamedNames.has("User")).toBe(false);
  });
});

describe("planMoveToShared", () => {
  const sources = {
    "src/features/cart/components/Price/Price.tsx": [
      'import { useCart } from "../../hooks/useCart";',
      'import { format } from "../../../../utils/format";',
      'import styles from "./Price.module.css";',
      "",
    ].join("\n"),
    "src/features/cart/index.ts":
      'export { Price } from "./components/Price/Price";\n',
    "src/features/checkout/Checkout.tsx":
      'import { Price } from "@/features/cart/components/Price/Price";\n',
  };
  const plan = planMoveToShared(
    project(sources, "src/features/cart/components/Price"),
    "src/features/cart/components/Price",
    "src/components/Price",
  );
  const after = apply(sources, plan);

  it("moves the folder and fixes imports in and out of it", () => {
    expect(plan.renames).toEqual([
      {
        from: "src/features/cart/components/Price",
        to: "src/components/Price",
      },
    ]);
    expect(after["src/components/Price/Price.tsx"]).toBe(
      [
        'import { useCart } from "../../features/cart/hooks/useCart";',
        'import { format } from "../../utils/format";',
        'import styles from "./Price.module.css";',
        "",
      ].join("\n"),
    );
    expect(after["src/features/cart/index.ts"]).toBe(
      'export { Price } from "../../components/Price/Price";\n',
    );
    expect(after["src/features/checkout/Checkout.tsx"]).toBe(
      'import { Price } from "@/components/Price/Price";\n',
    );
  });

  it("warns when the moved code would depend on a feature", () => {
    expect(plan.warnings).toEqual([
      'Price.tsx imports "../../hooks/useCart" from the "cart" feature. After the move, shared code would depend on that feature.',
    ]);
  });
});

describe("planMovePath", () => {
  it("moves one file, including imports that leave out its extension", () => {
    const sources = {
      "src/features/cart/useCart.ts": 'import { api } from "./api";\n',
      "src/features/cart/api.ts": "export const api = 1;\n",
      "src/features/cart/index.ts": 'export { useCart } from "./useCart";\n',
      "src/app/App.tsx":
        'import { useCart } from "../features/cart/useCart.ts";\n',
    };
    const plan = planMovePath(
      project(sources, "src/features/cart"),
      "src/features/cart/useCart.ts",
      "src/features/cart/hooks/useCart.ts",
    );
    const after = apply(sources, plan);
    expect(after["src/features/cart/hooks/useCart.ts"]).toBe(
      'import { api } from "../api";\n',
    );
    expect(after["src/features/cart/index.ts"]).toBe(
      'export { useCart } from "./hooks/useCart";\n',
    );
    expect(after["src/app/App.tsx"]).toBe(
      'import { useCart } from "../features/cart/hooks/useCart.ts";\n',
    );
  });
});

describe("addRoute", () => {
  const request = {
    component: "SettingsPage",
    importFrom: "../features/settings",
    path: "/settings",
  };

  it("adds a child route to the generated project's layout route", () => {
    const text = routesSource({
      name: "demo",
      styling: "css-modules",
      tests: true,
      routing: true,
      pathAlias: false,
      paths: DEFAULT_MANIFEST.paths,
      packageManager: PACKAGE_MANAGERS.npm,
    });
    const result = addRoute("src/app/routes.tsx", text, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(applyChanges(text, result.changes)).toBe(
      [
        'import { createBrowserRouter } from "react-router";',
        'import { AppLayout } from "../components/layout/AppLayout/AppLayout";',
        'import { Home } from "../features/home";',
        'import { SettingsPage } from "../features/settings";',
        "",
        "export const router = createBrowserRouter([",
        "  {",
        '    path: "/",',
        "    element: <AppLayout />,",
        "    children: [",
        "      { index: true, element: <Home /> },",
        '      { path: "settings", element: <SettingsPage /> },',
        "    ],",
        "  },",
        "]);",
        "",
      ].join("\n"),
    );
  });

  it("adds to a multi-line top-level list and joins an existing import", () => {
    const text = [
      'import { createBrowserRouter } from "react-router";',
      'import { Home } from "../features/settings";',
      "",
      "const routes = [",
      '  { path: "/", element: <Home /> },',
      '  { path: "/about", element: <About /> }',
      "];",
      "export const router = createBrowserRouter(routes);",
      "",
    ].join("\n");
    const result = addRoute("routes.tsx", text, request);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const updated = applyChanges(text, result.changes);
    expect(updated).toContain(
      'import { Home, SettingsPage } from "../features/settings";',
    );
    expect(updated).toContain(
      '  { path: "/about", element: <About /> },\n  { path: "/settings", element: <SettingsPage /> }\n];',
    );
  });

  it("refuses duplicates and files it doesn't understand", () => {
    const text =
      'createBrowserRouter([{ path: "/settings", element: <X /> }]);';
    expect(addRoute("r.tsx", text, request)).toEqual({
      ok: false,
      reason: 'there is already a route for "/settings"',
    });
    expect(addRoute("r.tsx", "export const x = 1;", request).ok).toBe(false);
  });
});
