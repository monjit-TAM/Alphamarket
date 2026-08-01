// Lightweight markdown renderer - no external dependencies.
// Supports: # ## ### #### headings, **bold**, [text](url) links,
// - bullet lists, 1. numbered lists, and paragraphs.

function renderInline(text: string, keyPrefix: string): React.ReactNode[] {
  const nodes: React.ReactNode[] = [];
  let remaining = text;
  let idx = 0;
  // Combined regex for **bold** and [label](url)
  const pattern = /(\*\*([^*]+)\*\*)|(\[([^\]]+)\]\(([^)]+)\))/;
  while (remaining.length > 0) {
    const m = remaining.match(pattern);
    if (!m || m.index === undefined) {
      nodes.push(remaining);
      break;
    }
    if (m.index > 0) nodes.push(remaining.slice(0, m.index));
    if (m[1]) {
      // bold
      nodes.push(<strong key={`${keyPrefix}-b-${idx++}`}>{m[2]}</strong>);
    } else if (m[3]) {
      // link
      const label = m[4], url = m[5];
      const isExternal = url.startsWith("http");
      nodes.push(
        <a key={`${keyPrefix}-a-${idx++}`} href={url}
           {...(isExternal ? { target: "_blank", rel: "noopener noreferrer" } : {})}>
          {label}
        </a>
      );
    }
    remaining = remaining.slice(m.index + m[0].length);
  }
  return nodes;
}

export function MarkdownContent({ markdown }: { markdown: string }) {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: React.ReactNode[] = [];
  let i = 0;
  let key = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (trimmed === "") { i++; continue; }

    // Headings
    const h = trimmed.match(/^(#{1,5})\s+(.*)$/);
    if (h) {
      const level = h[1].length;
      const content = renderInline(h[2], `h${key}`);
      if (level === 1) blocks.push(<h2 key={key++}>{content}</h2>);
      else if (level === 2) blocks.push(<h3 key={key++}>{content}</h3>);
      else if (level === 3) blocks.push(<h4 key={key++}>{content}</h4>);
      else blocks.push(<h5 key={key++}>{content}</h5>);
      i++;
      continue;
    }

    // Bullet list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^[-*]\s+/, "");
        items.push(<li key={items.length}>{renderInline(itemText, `ul${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ul key={key++}>{items}</ul>);
      continue;
    }

    // Numbered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: React.ReactNode[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        const itemText = lines[i].trim().replace(/^\d+\.\s+/, "");
        items.push(<li key={items.length}>{renderInline(itemText, `ol${key}-${items.length}`)}</li>);
        i++;
      }
      blocks.push(<ol key={key++}>{items}</ol>);
      continue;
    }

    // Paragraph (collect consecutive non-empty, non-special lines)
    const paraLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "" &&
           !/^(#{1,5})\s+/.test(lines[i].trim()) &&
           !/^[-*]\s+/.test(lines[i].trim()) &&
           !/^\d+\.\s+/.test(lines[i].trim())) {
      paraLines.push(lines[i].trim());
      i++;
    }
    blocks.push(<p key={key++}>{renderInline(paraLines.join(" "), `p${key}`)}</p>);
  }

  return <>{blocks}</>;
}
