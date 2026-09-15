export type ChatToolCall = {
  id?: string;
  name?: string;
  arguments?: unknown;
};

export type ChatMessage = {
  role: string;
  content?: string;
  toolCalls?: ChatToolCall[];
  toolCallId?: string;
};

const isChatMessage = (value: unknown): value is ChatMessage => {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const { role, content } = value as {
    role?: unknown;
    content?: unknown;
  };
  return (
    typeof role === "string" &&
    (content === undefined || typeof content === "string")
  );
};

export const parseMessages = (
  raw: string,
): ChatMessage[] | undefined => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (Array.isArray(parsed) && parsed.every(isChatMessage)) {
      return parsed;
    }
    return undefined;
  } catch {
    return undefined;
  }
};

export const MessagesView = ({
  label,
  raw,
}: {
  label: string;
  raw: string | undefined;
}) => {
  if (raw === undefined) {
    return null;
  }

  const messages = parseMessages(raw);
  if (messages === undefined) {
    return (
      <div>
        <div className="label">{label}</div>
        <pre>{raw}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="label">{label}</div>
      {messages.map((message, index) => (
        <div className="message" key={index}>
          <div className="role">
            {message.role}
            {message.toolCallId !== undefined
              ? ` (${message.toolCallId})`
              : ""}
          </div>
          {message.content !== undefined && message.content !== "" ? (
            <div className="content">{message.content}</div>
          ) : null}
          {message.toolCalls !== undefined &&
          message.toolCalls.length > 0 ? (
            <ul>
              {message.toolCalls.map((call, callIndex) => (
                <li key={call.id ?? callIndex}>
                  {call.name}{" "}
                  <code>{JSON.stringify(call.arguments)}</code>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
};
