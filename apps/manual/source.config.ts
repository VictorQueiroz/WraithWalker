import { defineConfig, defineDocs } from "fumadocs-mdx/config";
import { rehypeCode } from "fumadocs-core/mdx-plugins";

export const docs = defineDocs({
  dir: "../../docs"
});

export default defineConfig({
  mdxOptions: {
    rehypePlugins: [
      [
        rehypeCode,
        {
          themes: {
            light: "github-light",
            dark: "github-dark"
          },
          langs: [
            "bash",
            "json",
            "toml",
            "typescript",
            "javascript",
            "tsx",
            "mdx",
            "text"
          ]
        }
      ]
    ]
  }
});
