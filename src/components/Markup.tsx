export function Markup({
  html,
  className,
  as: Tag = "span",
}: {
  html: string;
  className?: string;
  as?: "span" | "div";
}) {
  return <Tag className={className} dangerouslySetInnerHTML={{ __html: html }} />;
}
