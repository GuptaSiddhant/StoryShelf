// typedoc-plugin-markdown links a module page as `<module>/index.md`; Starlight serves that
// file at `<module>/`, so drop the trailing `index/` from links into the generated reference.
const TRAILING_INDEX = /^(?<base>\/reference\/.*\/)index\/(?<hash>#.*)?$/u;

function visit(node) {
  if (node.type === "link" && typeof node.url === "string") {
    node.url = node.url.replace(TRAILING_INDEX, "$<base>$<hash>");
  }
  for (const child of node.children ?? []) visit(child);
}

export default function remarkReferenceLinks() {
  return (tree) => visit(tree);
}
