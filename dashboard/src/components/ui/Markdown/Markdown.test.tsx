import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { Markdown } from "./Markdown.js";

const ENTITIES: Record<string, string> = {
  "&lt;": "<",
  "&gt;": ">",
  "&amp;": "&",
  "&quot;": '"',
  "&#x27;": "'",
};

// What a person reads: the drawn page with its tags taken out.
const read = (text: string, state: "arriving" | "complete"): string =>
  renderToStaticMarkup(<Markdown text={text} state={state} />)
    .replace(/<[^>]+>/g, "")
    .replace(
      /&(lt|gt|amp|quot|#x27);/g,
      (entity) => ENTITIES[entity] ?? "",
    );

const html = (text: string, state: "arriving" | "complete"): string =>
  renderToStaticMarkup(<Markdown text={text} state={state} />);

// Every way the text can have arrived so far, one character at a time.
const arrivals = (text: string): string[] =>
  Array.from(text).map((_character, index) =>
    Array.from(text)
      .slice(0, index + 1)
      .join(""),
  );

// Answers whose words hold none of the marks of the syntax, so a mark
// that shows can only be syntax showing.
const ANSWERS = {
  emphasis: "これは **重要** で、*強調* と ~~取り消し~~ もあります。",
  code: "関数 `run` を呼びます。次に `stop` です。",
  link: "詳しくは [公式の説明](https://example.com/docs) を見てください。",
  heading: "# 見出し\n\n本文です。\n\n## 小見出し\n\n続きです。",
  list: "手順です。\n\n- 最初に **準備** します\n- 次に `build` します\n\n1. 一つ目\n2. 二つ目",
  quote: "> 引用の **一文** です。\n\n本文に戻ります。",
  table: "| 名前 | 値 |\n| --- | --- |\n| 幅 | 広い |\n| 高さ | 低い |",
  fence: "コードです。\n\n```ts\nconst a = 1;\n```\n\n以上です。",
  nested: "**太字の中の `code` と *斜体* です** 終わり。",
  linkInBold: "**[公式](https://example.com) を参照** です。",
  boldInLink: "[**重要** な説明](https://example.com) です。",
  underscores: "_斜体_ と __太字__ です。",
  codeInList: "- `a` と **b**\n- [c](https://example.com) と ~~d~~",
};

const MARKS = /[*`~[\]#>|]/;

describe("Markdown while the text arrives", () => {
  for (const [name, answer] of Object.entries(ANSWERS)) {
    it(`shows none of the syntax at any point of: ${name}`, () => {
      const showing = arrivals(answer).filter((arrived) =>
        MARKS.test(read(arrived, "arriving")),
      );

      expect(showing).toEqual([]);
    });
  }

  it("draws bold from its first character", () => {
    expect(html("これは **重", "arriving")).toContain(
      '<strong class="font-semibold">重</strong>',
    );
  });

  it("holds back a mark that has nothing to form yet", () => {
    expect(read("これは **", "arriving")).toBe("これは");
  });

  it("draws inline code from its first character", () => {
    expect(read("関数 `ru", "arriving")).toBe("関数 ru");
    expect(html("関数 `ru", "arriving")).toContain("<code");
  });

  it("draws a link's words before its address has arrived, as no link", () => {
    const drawn = html("詳しくは [公式の説明](https://exa", "arriving");

    expect(drawn).toContain("公式の説明");
    expect(drawn).not.toContain("<a ");
  });

  it("holds back a table until the line that makes it one has arrived", () => {
    expect(read("表です。\n\n| 名前 | 値 |\n| --- |", "arriving")).toBe(
      "表です。",
    );
    expect(
      html("表です。\n\n| 名前 | 値 |\n| --- | --- |", "arriving"),
    ).toContain("<table");
  });

  it("draws a code block as code before its fence closes", () => {
    const drawn = read("```ts\nconst a = 1;", "arriving");

    expect(drawn).toContain("const a = 1;");
    expect(drawn).not.toContain("`");
  });

  it("shows a mark that turns out to be an ordinary character, once what follows it arrives", () => {
    expect(read("1 *", "arriving")).toBe("1");
    expect(read("1 * 2 は 2", "arriving")).toBe("1 * 2 は 2");
  });

  it("holds back an image until all of it has arrived", () => {
    expect(read("図です ![構成図](https://exa", "arriving")).toBe(
      "図です",
    );
  });

  it("shows text that never grows, the same on every arrival", () => {
    const seen = arrivals("一 二 三").map((arrived) =>
      read(arrived, "arriving"),
    );

    expect(seen).toEqual(["一", "一", "一 二", "一 二", "一 二 三"]);
  });
});

describe("Markdown once the text is complete", () => {
  it("draws a mark the writer never closed as it was written", () => {
    expect(read("これは **重要", "complete")).toBe("これは **重要");
  });

  it("does not draw HTML in the text", () => {
    expect(read("<b>太字</b>", "complete")).toBe("<b>太字</b>");
  });

  it("follows only links out to the web", () => {
    expect(html("[a](javascript:alert(1))", "complete")).not.toContain(
      "<a ",
    );
    expect(html("[a](https://example.com)", "complete")).toContain(
      'href="https://example.com"',
    );
  });
});
