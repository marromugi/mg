// 実装が本文の文を印付けする 2 つの方法です。
// withoutServiceText は本文の文を伏せた自分の文で、
// causeQuotesService は cause の文が本文を引いていることを示します。
export type ServiceTextMark = {
  withoutServiceText?: string;
  causeQuotesService?: true;
};

export type ReasonErrorOptions = {
  cause?: unknown;
} & ServiceTextMark;

export const SERVICE_TEXT_LEFT_OUT = "(text from the service left out)";

const NON_ERROR_CAUSE = "(non-Error cause)";

// cause の連鎖を下って、理由の文を集めます。
// textOf は連鎖の中の Error から、集める文を選びます。
// ReasonError の文はすでに完結しているので、そこで止まります。
const causeTexts = (
  cause: unknown,
  textOf: (error: Error) => string,
): string[] => {
  const texts: string[] = [];
  const seen = new Set<unknown>();
  let current = cause;
  while (current !== undefined) {
    if (typeof current === "string") {
      if (current !== "") texts.push(current);
      break;
    }
    if (!(current instanceof Error)) {
      texts.push(NON_ERROR_CAUSE);
      break;
    }
    if (seen.has(current)) break;
    seen.add(current);
    const text = textOf(current);
    if (text !== "") texts.push(text);
    if (current instanceof ReasonError) break;
    current = current.cause;
  }
  return texts;
};

// 自分の文に cause の連鎖の理由を続けた message と、
// 外部サービスの文を伏せた messageWithoutServiceText を持つ Error です。
export abstract class ReasonError extends Error {
  readonly messageWithoutServiceText: string;

  protected constructor(message: string, options?: ReasonErrorOptions) {
    super(
      [
        message,
        ...causeTexts(options?.cause, (error) => error.message),
      ].join(": "),
      options,
    );
    const start = options?.withoutServiceText ?? message;
    this.messageWithoutServiceText =
      options?.causeQuotesService === true
        ? `${start}: ${SERVICE_TEXT_LEFT_OUT}`
        : [
            start,
            ...causeTexts(options?.cause, (error) =>
              error instanceof ReasonError
                ? error.messageWithoutServiceText
                : error.message,
            ),
          ].join(": ");
  }
}
