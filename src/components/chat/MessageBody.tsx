import { useState, type AnchorHTMLAttributes } from "react";
import { useTranslation } from "react-i18next";
import { ChevronDown, ChevronRight } from "lucide-react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { openUrl } from "@tauri-apps/plugin-opener";

interface MessageBodyProps {
  content?: string;
  reasoningContent?: string;
}

export default function MessageBody({ content, reasoningContent }: MessageBodyProps) {
  const { t } = useTranslation("chat");
  const [showReasoning, setShowReasoning] = useState(false);

  return (
    <>
      {reasoningContent && (
        <div className="reasoning-toggle" onClick={() => setShowReasoning(!showReasoning)}>
          {showReasoning ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
          <span>{t("thinking.label")}</span>
        </div>
      )}
      {showReasoning && reasoningContent && (
        <div className="reasoning-content">{reasoningContent}</div>
      )}
      {content && (
        <div className="markdown-body">
          <Markdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeHighlight]}
            components={{
              a: ({ href, children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => (
                <a
                  {...props}
                  href={href}
                  onClick={(event) => {
                    event.preventDefault();
                    if (href && /^https?:\/\//i.test(href)) {
                      openUrl(href).catch(() => {});
                    }
                  }}
                >
                  {children}
                </a>
              ),
            }}
          >
            {content}
          </Markdown>
        </div>
      )}
    </>
  );
}
