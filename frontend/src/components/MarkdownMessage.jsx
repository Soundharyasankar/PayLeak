import { parseMarkdown, parseMarkdownInline } from "../utils/markdown.js";

function InlineContent({ text }) {
  return parseMarkdownInline(text).map((part, index) => {
    if (part.type === "strong") return <strong key={index}>{part.text}</strong>;
    if (part.type === "emphasis") return <em key={index}>{part.text}</em>;
    if (part.type === "code") return <code key={index}>{part.text}</code>;
    return <span key={index}>{part.text}</span>;
  });
}

export default function MarkdownMessage({ text }) {
  return (
    <div className="message-markdown">
      {parseMarkdown(text).map((block, index) => {
        if (block.type === "heading") {
          const Heading = `h${Math.min(block.level + 1, 6)}`;
          return <Heading key={index}><InlineContent text={block.text} /></Heading>;
        }
        if (block.type === "list") {
          const List = block.ordered ? "ol" : "ul";
          return <List key={index}>{block.items.map((item, itemIndex) => (
            <li key={itemIndex}><InlineContent text={item} /></li>
          ))}</List>;
        }
        if (block.type === "table") {
          return (
            <div className="message-table-scroll" key={index}>
              <table>
                <thead><tr>{block.headers.map((cell, cellIndex) => <th key={cellIndex}><InlineContent text={cell} /></th>)}</tr></thead>
                <tbody>{block.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{block.headers.map((_header, cellIndex) => (
                    <td key={cellIndex}><InlineContent text={row[cellIndex] ?? ""} /></td>
                  ))}</tr>
                ))}</tbody>
              </table>
            </div>
          );
        }
        return <p key={index}><InlineContent text={block.text} /></p>;
      })}
    </div>
  );
}
