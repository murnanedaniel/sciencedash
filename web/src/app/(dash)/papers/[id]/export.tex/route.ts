import { prisma } from "@/lib/prisma";

export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const paper = await prisma.paper.findUnique({
    where: { id },
    include: {
      sections: { orderBy: { order: "asc" } },
      primaryProject: true,
    },
  });
  if (!paper) return new Response("not found", { status: 404 });

  const esc = (s: string) =>
    s
      .replace(/\\/g, "\\textbackslash{}")
      .replace(/([&%$#_{}])/g, "\\$1")
      .replace(/~/g, "\\textasciitilde{}")
      .replace(/\^/g, "\\textasciicircum{}");

  const sectionCmd = (kind: string) =>
    kind === "intro" || kind === "related" || kind === "conclusion" || kind === "discussion"
      ? "\\section"
      : kind === "figure_list"
        ? "\\section*"
        : "\\section";

  const body = paper.sections
    .map(
      (s) =>
        `${sectionCmd(s.kind)}{${esc(s.title)}}\n${s.contentMd ? esc(s.contentMd) : ""}\n`,
    )
    .join("\n");

  const tex = `\\documentclass[11pt,a4paper]{article}
\\usepackage[utf8]{inputenc}
\\usepackage{graphicx}
\\usepackage{amsmath,amssymb}
\\usepackage{hyperref}
\\title{${esc(paper.title)}}
\\author{}
\\date{}
\\begin{document}
\\maketitle
${paper.abstract ? `\\begin{abstract}\n${esc(paper.abstract)}\n\\end{abstract}\n` : ""}
${body}
\\end{document}
`;

  return new Response(tex, {
    headers: {
      "content-type": "application/x-tex; charset=utf-8",
      "content-disposition": `attachment; filename="${slugify(paper.title) || "paper"}.tex"`,
    },
  });
}

function slugify(s: string) {
  return s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 60);
}
