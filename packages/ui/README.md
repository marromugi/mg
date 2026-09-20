# @mg/ui

汎用の画面コンポーネントと、トークンのファイルを持つパッケージです。

## 役割

ui の役割は 2 つです。

- トレースの意味を知らない、汎用のコンポーネントを持ちます。
- 色とフォントと影と角丸の、ただ 1 つの出どころとなるトークンのファイルを持ちます。

コンポーネントは Badge、Button、Card、Heading、Meta、Quote、Role、Table、
TextField の 9 つです。
それぞれの story と、story のスナップショットの試験も持ちます。

ui は、このリポジトリの他のパッケージに依存しません。
使う側の画面のルートも、ビルド結果の場所も知りません。
要るものは、すべて入力（props）で受け取ります。

## やらないこと

次のことは ui の外に任せます。

- トレースの意味を持つコンポーネントは持ちません。`@mg/trace-ui` の役割です。
- ページの外枠は持ちません。CSS の埋め込みや配色の切り替えは、使う側の役割です。
- CSS を生成しません。トークンのファイルを配るだけです。使う側が自分のビルドで CSS を作ります。

## ディレクトリ

`src` の下の置き場所を表にします。

| 置き場所             | 中身                                                   |
| -------------------- | ------------------------------------------------------ |
| `components/<Name>/` | コンポーネント本体と story                             |
| `styles/tokens.css`  | トークンの `@theme` と、コンポーネントを指す `@source` |

コンポーネントのディレクトリの中身は、どれも同じ形です。
`Badge` を例にします。

```
Badge/
├── Badge.tsx
├── Badge.stories.tsx
└── index.ts
```

`TextField` だけは `TextField.test.tsx` も持ちます。
アクセシビリティの結びつきを、story ではなく試験で確かめるからです。

ファイル名とディレクトリ名は、コンポーネント名と同じにします。
各コンポーネントのディレクトリに `index.ts` を置き、外へ出すものだけ並べます。
`src/index.ts` が、9 つのコンポーネントをまとめて出します。

## 見た目の決まり

色とフォントと影と角丸は、`src/styles/tokens.css` の `@theme` に集めます。
コンポーネントは、ここにある名前だけを使います。

コンポーネントは Tailwind の class で書きます。
状態ごとの切り替えは、tailwind-variants で持ちます。

`tokens.css` は `@source` で、自分の `components` を指します。
使う側が `tokens.css` を取り込んだときにも、ui の class が見つかるようにするためです。

CSS の生成は使う側の役割です。
ui はビルドで CSS を作りません。`tokens.css` をそのまま配ります。

lint は oxlint-tailwindcss を使い、`tokens.css` を入り口にして次を止めます。

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
pnpm --filter @mg/ui test
```

意図して見た目を変えたときは、まず目で確かめます。
崩れがないと分かったら、保存した文字列を更新します。

```sh
pnpm --filter @mg/ui test -u
```

## Storybook

コンポーネントを 1 つずつ確かめるには、Storybook を動かします。

```sh
pnpm --filter @mg/ui storybook
```

待ち受けるポートは 6007 です。`@mg/trace-ui` の 6006 番と同時に動かせます。
