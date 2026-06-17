import { useLoaderData, type LoaderFunctionArgs } from "react-router";
import { DocsLayout } from "fumadocs-ui/layouts/docs";
import {
  DocsBody,
  DocsDescription,
  DocsPage,
  DocsTitle,
  MarkdownCopyButton,
  ViewOptionsPopover,
} from "fumadocs-ui/layouts/docs/page";
import { getPageMarkdownUrl, source } from "@/lib/source";
import browserCollections from "collections/browser";
import { baseOptions } from "@/lib/layout.shared";
import { gitConfig } from "@/lib/shared";
import { articleJsonLd, canonicalUrl, OG_IMAGE } from "@/lib/seo";
import { useFumadocsLoader } from "fumadocs-core/source/client";
import { useMDXComponents } from "@/components/mdx";

export async function loader({ params }: LoaderFunctionArgs) {
  const slugs = (params["*"] ?? "").split("/").filter((v) => v.length > 0);
  const page = source.getPage(slugs);
  if (!page) throw new Response("Not found", { status: 404 });

  return {
    path: page.path,
    url: page.url,
    markdownUrl: getPageMarkdownUrl(page).url,
    pageTree: await source.serializePageTree(source.getPageTree()),
  };
}

const clientLoader = browserCollections.docs.createClientLoader({
  component(
    { toc, frontmatter, default: Mdx },
    { markdownUrl, path, url }: { markdownUrl: string; path: string; url: string },
  ) {
    const canonical = canonicalUrl(url);
    const title = `${frontmatter.title} — Noteside Docs`;
    return (
      <DocsPage toc={toc}>
        {/* SEO — React 19 hoists these into the prerendered <head>. */}
        <title>{title}</title>
        <meta name="description" content={frontmatter.description} />
        <link rel="canonical" href={canonical} />
        <meta property="og:type" content="article" />
        <meta property="og:site_name" content="Noteside Docs" />
        <meta property="og:title" content={title} />
        <meta property="og:description" content={frontmatter.description} />
        <meta property="og:url" content={canonical} />
        <meta property="og:image" content={OG_IMAGE} />
        <meta property="og:image:width" content="1200" />
        <meta property="og:image:height" content="630" />
        <meta property="og:image:type" content="image/png" />
        <meta property="og:image:alt" content="Noteside documentation" />
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content={title} />
        <meta name="twitter:description" content={frontmatter.description} />
        <meta name="twitter:image" content={OG_IMAGE} />
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            // Escape `<` so a stray "</script>" in trusted frontmatter can't break out.
            __html: JSON.stringify(
              articleJsonLd({
                title: frontmatter.title,
                description: frontmatter.description,
                url: canonical,
              }),
            ).replace(/</g, "\\u003c"),
          }}
        />
        <DocsTitle>{frontmatter.title}</DocsTitle>
        <DocsDescription>{frontmatter.description}</DocsDescription>
        <div className="flex flex-row gap-2 items-center border-b -mt-4 pb-6">
          <MarkdownCopyButton markdownUrl={markdownUrl} />
          <ViewOptionsPopover
            markdownUrl={markdownUrl}
            githubUrl={`https://github.com/${gitConfig.user}/${gitConfig.repo}/blob/${gitConfig.branch}/apps/docs/content/docs/${path}`}
          />
        </div>
        <DocsBody>
          <Mdx components={useMDXComponents()} />
        </DocsBody>
      </DocsPage>
    );
  },
});

export default function Page() {
  const loaderData = useLoaderData<typeof loader>();
  const { pageTree, path, markdownUrl } = useFumadocsLoader(loaderData);

  return (
    <DocsLayout {...baseOptions()} tree={pageTree}>
      {clientLoader.useContent(loaderData.path, { markdownUrl, path, url: loaderData.url })}
    </DocsLayout>
  );
}
