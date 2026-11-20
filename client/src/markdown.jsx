// Tiny, safe renderer for the formatting the AI uses: **bold**, `code`, numbered and bulleted lists.
// It builds React elements directly (no HTML injection).
const LIST = /^(\s*)(\d+[.)]|[-*\u2022])\s+(.*)$/;

function inline(text) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`)/g).map((part, i) => {
    if (part.length > 4 && part.startsWith('**') && part.endsWith('**')) {
      return <strong key={i}>{part.slice(2, -2)}</strong>;
    }
    if (part.length > 2 && part.startsWith('`') && part.endsWith('`')) {
      return <code key={i}>{part.slice(1, -1)}</code>;
    }
    return part;
  });
}

export default function Markdown({ text }) {
  const blocks = [];
  let list = null;

  for (const raw of text.split('\n')) {
    const m = raw.match(LIST);
    if (m) {
      if (!list) {
        list = { ordered: /\d/.test(m[2]), items: [] };
        blocks.push(list);
      }
      if (m[1].length >= 2 && list.items.length) list.items[list.items.length - 1].sub.push(m[3]);
      else list.items.push({ text: m[3], sub: [] });
    } else if (raw.trim()) {
      list = null;
      blocks.push({ para: raw });
    }
  }

  return blocks.map((b, i) => {
    if (b.para !== undefined) return <p key={i}>{inline(b.para)}</p>;
    const Tag = b.ordered ? 'ol' : 'ul';
    return (
      <Tag key={i}>
        {b.items.map((item, j) => (
          <li key={j}>
            {inline(item.text)}
            {item.sub.length > 0 && (
              <ul>{item.sub.map((s, k) => <li key={k}>{inline(s)}</li>)}</ul>
            )}
          </li>
        ))}
      </Tag>
    );
  });
}
