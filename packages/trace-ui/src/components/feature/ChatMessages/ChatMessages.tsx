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
        <div className="mt-2 font-semibold">{label}</div>
        <pre className="my-4">{result.raw}</pre>
      </div>
    );
  }

  return (
    <div>
      <div className="mt-2 font-semibold">{label}</div>
      {result.messages.map((message, index) => (
        <div
          className="my-1.5 border-l-2 border-edge px-2.5 py-1"
          key={index}
        >
          <div className="text-xs font-semibold uppercase opacity-70">
            {message.role}
            {message.toolCallId !== undefined
              ? ` (${message.toolCallId})`
              : ""}
          </div>
          {message.content !== undefined && message.content !== "" ? (
            <div className="whitespace-pre-wrap">{message.content}</div>
          ) : null}
          {message.toolCalls !== undefined &&
          message.toolCalls.length > 0 ? (
            <ul className="my-4 list-disc pl-10">
              {message.toolCalls.map((call, callIndex) => (
                <li key={call.id ?? callIndex}>
                  {call.name}{" "}
                  <code className="break-all whitespace-pre-wrap">
                    {JSON.stringify(call.arguments)}
                  </code>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
};
