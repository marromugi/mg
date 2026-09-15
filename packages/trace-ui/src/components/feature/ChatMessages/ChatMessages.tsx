import { useChatMessages } from "./hooks/useChatMessages.js";

export const ChatMessages = ({
  label,
  raw,
}: {
  label: string;
  raw: string | undefined;
}) => {
  if (raw === undefined) {
    return null;
  }

  const result = useChatMessages(raw);
  if (!("messages" in result)) {
    return (
      <div>
        <div className="label">{label}</div>
        <pre>{result.raw}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="label">{label}</div>
      {result.messages.map((message, index) => (
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
