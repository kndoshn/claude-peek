# md-review

Claude が書いた Markdown を、セッションから離れずにレビューするための Claude Code の mod です。
`/md` でファイルをチャットの横のパネルに表示します。マウスで範囲を選んで **選択を引用** を押すと、
ファイル名と行番号の付いた引用として入力欄に入ります。別のタブもエディタもブラウザも要りません。

[English](README.md)

## インストール

Claude Code のターミナルのセッションで、入力欄に次を入力します。

```
/plugin install md-review --marketplace kndoshn/md-review
```

marketplace の追加を `y` で承認し、スコープを選びます（先頭がユーザーのスコープです）。

シェルからは次のとおりです。

```
claude plugin install md-review --marketplace kndoshn/md-review
```

`/plugin` が動かないデスクトップアプリでは、入力欄の横の + から Plugins を開き、Add marketplace に
`kndoshn/md-review` を入れてから Add plugin を選びます。

md-review は hooks module（mod）なので、それを読み込める Claude Code が要ります。Claude Code
2.1.316 で動作を確かめています。引用はマウスの選択範囲を読むので、フルスクリーンのターミナルで
使います。パネルは 110 桁以上でトランスクリプトの横に、それより狭いと入力欄の上に表示されます。

## 使い方

| 操作 | md-review の動き |
| --- | --- |
| `/md` | 直近の会話で Claude が書いた・編集した・読んだ・名前を出した `.md` のうち、いちばん新しいものを開く |
| `/md docs/plan.md` | そのファイルを開く。作業ディレクトリからの相対パス、`~/...`、絶対パスのどれでもよい |
| `/md plan` | 名前の一部にいちばん合うファイルを開く。会話に出たファイルが先、次にプロジェクトのファイル |
| `/md pl` と入力中 | 合う Markdown ファイルを補完の候補に出す |
| 返答が `.md` に触れた | 入力欄の上に **開く: docs/plan.md** を出す。**×** で消える |

ファイルを開いている間は、入力欄の上に次のボタンが並びます。

- **選択を引用**: パネルで選んだ範囲を、入力中の文の後ろに足します。

  ```
  docs/plan.md:12-14
  > The first step.
  >
  > - see the setup guide
  ```

  行番号は、選んだテキストをファイルの中から探して付けます。見つからないとき（画像の代替テキスト
  など）は、ファイル名だけを付けます。
- **再読込**: ファイルを読み直します。ファイルは 1 秒ごとに確かめていて、ディスク上で変わると
  （Claude・エディタ・スクリプトのどれが変えても）パネルを描き直します。
- **閉じる**: パネルを閉じます。Esc やパネルの閉じるマークでも閉じます。

開けるのは `.md` と `.markdown` だけです。プロジェクトのファイルは `git ls-files` の一覧（追跡中と
未追跡のもの。無視するものは除く）から、git のリポジトリの外では `fd` があればその一覧から探します。

## 設定

`/config` に md-review の行が 1 つあります。

| 設定 | 値 | 既定値 |
| --- | --- | --- |
| Language | `auto`、`en`、`ja` | `auto`: Claude Code の `language` の設定、次にロケール（`LC_ALL`・`LC_MESSAGES`・`LANG`）、どれもなければ英語 |

## 開発

```
claude --plugin-dir .            # このフォルダを読み込んでセッションを始める。保存すると読み直す
claude plugin test .             # tests/*.test.tsx を実行する
claude plugin validate .         # マニフェストと hooks module を検査する
```

hooks module は `hooks/register.tsx` です。純粋な関数は `hooks/text.ts`、メッセージは
`hooks/messages.ts` にあります。

## ライセンス

MIT
