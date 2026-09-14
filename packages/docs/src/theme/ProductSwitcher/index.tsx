import useDocusaurusContext from "@docusaurus/useDocusaurusContext";
import useBaseUrl from "@docusaurus/useBaseUrl";
import { useActivePlugin, useAllDocsData } from "@docusaurus/plugin-content-docs/client";
import type { PropSidebarItemHtml } from "@docusaurus/plugin-content-docs";

type Product = { id: string; label: string; icon?: string };

/*
 * Path data of the lucide icons the switcher uses, copied from lucide-react 1.33.0.
 * The sidebar icons in src/theme/SidebarIcon are React components, which cannot be
 * rendered into the string this item has to be. Keys come from `icon` in products.js.
 */
const ICON_PATHS: Record<string, string> = {
  "chevron-down": '<path d="m6 9 6 6 6-6"/>',
  "cloud": '<path d="M17.5 19H9a7 7 0 1 1 6.71-9h1.79a4.5 4.5 0 1 1 0 9Z"/>',
  "wrench":
    '<path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.106-3.105c.32-.322.863-.22.983.218a6 6 0 0 1-8.259 7.057l-7.91 7.91a1 1 0 0 1-2.999-3l7.91-7.91a6 6 0 0 1 7.057-8.259c.438.12.54.662.219.984z"/>',
};

function icon(name: string | undefined, className: string): string {
  const paths = name ? ICON_PATHS[name] : undefined;
  if (!paths) {
    return "";
  }
  return `<svg class="${className}" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths}</svg>`;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/*
 * The product switcher at the top of the docs sidebar. Each product is one docs plugin
 * instance (see products.js); the switch links to the first page of that product's sidebar.
 *
 * The shared theme (@swmansion/t-rex-ui) renders sidebar items from its own bundle and
 * accepts an `html` item as a string only, so the dropdown is a native <details> element,
 * which needs no script of its own, instead of a React component.
 */
export default function useProductSwitcherItem(): PropSidebarItemHtml {
  const { siteConfig } = useDocusaurusContext();
  const products = siteConfig.customFields?.products as Product[];
  const activeId = useActivePlugin({ failfast: false })?.pluginId ?? "default";
  const docsData = useAllDocsData();
  const baseUrl = useBaseUrl("/");

  const active = products.find((product) => product.id === activeId) ?? products[0];

  const links = products
    .map((product) => {
      const version = docsData[product.id]?.versions.find((candidate) => candidate.isLast);
      const mainDoc = version?.docs.find((doc) => doc.id === version.mainDocId);
      if (!mainDoc) {
        return "";
      }
      // `path` is already prefixed with the site's baseUrl.
      const href = mainDoc.path.startsWith(baseUrl) ? mainDoc.path : `${baseUrl}${mainDoc.path}`;
      const current = product.id === active.id ? ' aria-current="page"' : "";
      return `<li><a href="${escapeHtml(href)}"${current}>${icon(product.icon, "product-switcher__icon")}${escapeHtml(product.label)}</a></li>`;
    })
    .join("");

  return {
    type: "html",
    className: "product-switcher",
    defaultStyle: false,
    value: `<details class="product-switcher__menu"><summary aria-label="Switch product">${icon(active.icon, "product-switcher__icon")}<span class="product-switcher__label">${escapeHtml(active.label)}</span>${icon("chevron-down", "product-switcher__chevron")}</summary><ul>${links}</ul></details>`,
  };
}
