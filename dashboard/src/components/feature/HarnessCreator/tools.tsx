import type { ToolName } from "../../../definition/index.js";
import type { Option } from "../../ui/index.js";

type About = { summary: string; detail: string };

const ABOUT: Record<ToolName, About> = {
  bash: {
    summary: "シェルのコマンドを実行します",
    detail:
      "作業フォルダでシェルのコマンドを実行し、出力と終了コードを受け取ります。テストやビルドなど、コマンドでできることは何でもできます。作業フォルダの外にも触れられるので、止めたい操作があるときはゲートを使います。",
  },
  read_file: {
    summary: "ファイルを読みます",
    detail:
      "作業フォルダの中のテキストファイルを、行番号を付けて読みます。読む範囲を行と桁で指定できるので、大きなファイルの一部だけを読むこともできます。",
  },
  grep: {
    summary: "ファイルの中身を検索します",
    detail:
      "作業フォルダの中のファイルを、文字列や正規表現で検索します。見つかった場所を、ファイル名と行と桁で返します。.gitignore に書かれたファイルは対象にしません。",
  },
  write_file: {
    summary: "ファイルを作るか、丸ごと書き換えます",
    detail:
      "作業フォルダの中にファイルを作ります。途中のフォルダがなければ、それも作ります。すでにあるファイルは、確認なしに丸ごと書き換えます。",
  },
  edit_file: {
    summary: "ファイルの一部を書き換えます",
    detail:
      "すでにあるファイルの中の、指定した文字列を別の文字列に置き換えます。置き換える箇所が 1 つに決まらないときは、何も変えずに失敗します。",
  },
};

// Each tool with one line on what it lets the harness do, and a longer
// explanation to open from its row.
export const toolOptions: Option[] = (
  Object.keys(ABOUT) as ToolName[]
).map((tool) => ({
  value: tool,
  label: tool,
  content: (
    <span className="flex flex-col">
      <span className="font-semibold">{tool}</span>
      <span className="text-xs opacity-70">{ABOUT[tool].summary}</span>
    </span>
  ),
  help: <p>{ABOUT[tool].detail}</p>,
}));
