# @mg/trace-ui

保存したトレースを、画面で見るためのパッケージです。

## 役割

trace-ui の役割は 3 つです。

- セッションの一覧を、表にして見せます。
- セッションを選ぶと、ツリーの形にして会話の流れを見せます。
- `@mg/trace/store` のリーダーを使い、トレースを取り出します。

trace-ui は、`@mg/trace/store` に加えて `@mg/term` に依存します。
端末への出力を、`@mg/term` で色付けします。
OpenTelemetry の SDK や、保存の仕組みは持ちません。

画面は Hono で作り、react-dom でサーバー側に描きます。
同じマシンで動かす前提で、認証は付けていません。

## やらないこと

次のことは trace-ui の外に任せます。

- 見る人を確かめる仕組みは持ちません。認証はありません。
- セッションを絞り込む機能は、まだありません。
- クライアント側で動く JS は持ちません。画面はサーバーだけで描きます。

## 動かし方

見るトレースが入った SQLite のパスを指定して、起動します。

```sh
pnpm --filter @mg/trace-ui start -- --db <path>
```

待ち受けるポートは、既定で 3210 です。
別のポートに変えるには、起動のコマンドに次の指定を足します。

```
--port <port>
```

待ち受けは `127.0.0.1` だけです。他のマシンからはつなげません。

指定したパスにファイルが無いと、起動を拒みます。
正しいパスを渡すよう、メッセージで知らせます。

コンポーネントを 1 つずつ確かめるには、Storybook を動かします。

```sh
pnpm --filter @mg/trace-ui storybook
```

待ち受けるポートは 6006 です。

## ディレクトリ

`src` の下の置き場所を、1 ディレクトリ 1 行で表します。

```
src/
├── routes/       リーダーを呼び、結果をページに渡します
├── components/
│   ├── ui/       トレースの意味を知らないコンポーネント
│   ├── feature/  トレースの意味を持つコンポーネント
│   └── pages/    1 ページ 1 コンポーネントで feature を並べます
├── hooks/        複数のコンポーネントで使う hooks
├── styles/       tokens.css
└── stories/      story で使う共通の fixture
```

`app.tsx`、`server.ts`、`vocabulary.ts`、`index.ts` は `src` の直下にあります。
それぞれ、画面の組み立て、起動、トレースの語彙、パッケージのエントリーポイントです。

コンポーネントのディレクトリの中身は、どの層でも同じ形です。
`ChatMessages` を例にします。

```
ChatMessages/
├── ChatMessages.tsx
├── ChatMessages.stories.tsx
├── index.ts
└── hooks/
    ├── useChatMessages.ts
    └── useChatMessages.test.ts
```

## 置き場所

3 層それぞれの役割と、置くものを表にします。

| 層      | 役割                                | 置くもの                                     |
| ------- | ----------------------------------- | -------------------------------------------- |
| ui      | トレースの意味を知りません          | Badge、Button、Card など汎用のコンポーネント |
| feature | トレースの意味を持ちます            | ChatMessages、SessionList、SpanTree          |
| pages   | 1 ページにつき 1 コンポーネントです | SessionsPage、SessionPage                    |

3 層とも、表示に関わる処理だけを持ちます。
表示に関わらない処理は、hooks に出します。

- 1 つのコンポーネントだけで使う処理は、そのコンポーネントの `hooks/` に置きます。
- 複数のコンポーネントで使う処理は、`src/hooks/` に置きます。
- テストは、hooks と同じ場所に置きます。

hooks は、描画中に呼ぶ普通の関数です。React の状態は持ちません。
名前は `use` で始めます。例えば `useChatMessages` です。

リーダーを呼ぶのは `routes/` だけです。コンポーネントはリーダーを知りません。
ページは、入力（props）でデータを受け取ります。
ルートは、リーダーの結果をページに渡すだけです。変換は hooks が持ちます。

ファイル名とディレクトリ名は、コンポーネント名と同じにします。
各コンポーネントのディレクトリに `index.ts` を置き、外へ出すものだけ並べます。
`components/ui/index.ts` は、ui のコンポーネントをまとめて出します。
feature と pages は、コンポーネントのディレクトリごとに出します。

足したいものごとに、置く場所を表にまとめます。

| 足したいもの                                       | 置く場所                    |
| -------------------------------------------------- | --------------------------- |
| トレースの意味を知らない汎用のコンポーネント       | components/ui               |
| トレースの意味を持つコンポーネント                 | components/feature          |
| 1 ページ 1 コンポーネントの画面                    | components/pages            |
| 1 つのコンポーネントだけで使う表示に関わらない処理 | そのコンポーネントの hooks/ |
| 複数のコンポーネントで使う表示に関わらない処理     | src/hooks/                  |
| リーダーを呼ぶ処理                                 | src/routes/                 |
| 色やフォントや影や角丸の値                         | src/styles/tokens.css       |

## 見た目の決まり

色とフォントと影と角丸は、`src/styles/tokens.css` の `@theme` に集めます。
コンポーネントは、ここにある名前だけを使います。

コンポーネントは Tailwind の class で書きます。
状態ごとの切り替えは、tailwind-variants で持ちます。

CSS はビルドで生成します。
サーバーは起動時にその CSS を読み、`<style>` に埋めます。
サーバーにバンドラーは入れません。

lint は oxlint-tailwindcss を使い、次を止めます。

| ルール                 | 止めるもの              |
| ---------------------- | ----------------------- |
| no-unknown-classes     | tokens.css に無い class |
| no-conflicting-classes | 競合する class          |
| no-arbitrary-value     | 任意の値を使った class  |
| no-hardcoded-colors    | 直接書いた色の値        |

次の 2 つは警告です。

- no-duplicate-classes
- enforce-sort-order

次を実行すると、並び順が直ります。

```sh
pnpm lint:fix
```

これらの決まりの理由は、[issue #100](https://github.com/marromugi/mg/issues/100) にまとめてあります。

## テスト

コンポーネントごとの story を、Node の中で HTML の文字列にします。
その文字列を、保存した文字列と比べます。ブラウザは使いません。
見た目が変わると、テストが落ちます。

比べる前に、両方の文字列から `<style>` の中身を空にします。
生成される CSS は、保存する文字列に含めません。

story は、Storybook での表示と、この比較の入力を兼ねます。
`Badge.stories.tsx` のように、コンポーネントのそばに置きます。

確かめるには、次を実行します。

```sh
pnpm --filter @mg/trace-ui test
```

意図して見た目を変えたときは、まず目で確かめます。
崩れがないと分かったら、保存した文字列を更新します。

```sh
pnpm --filter @mg/trace-ui test -u
```

ルートのテストは、モックのリーダーを渡して `app.request` を叩きます。
`src/app.test.tsx` がその形です。
