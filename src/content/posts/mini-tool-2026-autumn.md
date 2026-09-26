---
title: ミニツール 2026年秋
description: トークンの残飯処理
pubDate: 2026-09-26
---

サブスク形式でcoding agentを使うとweekly limitのreset時にtokenが余っていたりして勿体無いので色々実験がてらに作ってみた

# PyMOL上でChimeraX、Mol-*、CueMolのrepresentationを可視化するプラグイン by Astra

https://github.com/th2ch-g/chimerax_style_in_pymol

https://github.com/th2ch-g/molstar_style_in_pymol

https://github.com/th2ch-g/cuemol_style_in_pymol

おーいっすね〜

https://x.com/Ag_smith/status/2100979076571992348

CueMolのribbon表示は素晴らしくて、3になってからvscode風でGUIがかっこよくなっているのでもう少ししたらPyMOLから移行したい

https://x.com/cuemolnohito/status/2043320458406494403


# gh CLIによるextention by Opus4.X

OpenClawのレポ名が変わっていたのとかしれて面白い

https://github.com/th2ch-g/gh-user-history

https://github.com/th2ch-g/gh-repo-history

https://github.com/th2ch-g/gh-email-get


# 通信対戦可能なゲーム by Astra

Sergey先生のprotein_fighterに触発されて通信対戦も可能なゲームをいくつか作ってみた

peer.jsというやつでGithubPagesのような静的サイトでも通信対戦ができる様になっているらしい

https://github.com/sokrypton/protein_fighter

https://x.com/sokrypton/status/2099496292476989591


色々試してみたが、ぷよぷよテトリスは結構いい感じだった。他は微妙。。。

https://github.com/th2ch-g/game-life

https://github.com/th2ch-g/game-puyopuyo-tetris

https://github.com/th2ch-g/game-monster-hunter

https://github.com/th2ch-g/game-mario-kart


# topコマンドとかでメッセージを表示する by 人間

topとかでジョブが流れていないことを確認して非schedulerでジョブを投げるスタイルの共用サーバーで~~イタズラ~~するためのツール

`kanban single -m hello`とかでhelloのバイナリが生成され実行される

コア数指定や縦文字、長文字も表示可能で、wgpuでGPUにも対応している

claudeとかのcommitがあるがこれはリファクタリングで、人間がコードを書いてた時代に作った

https://github.com/th2ch-g/kanban
