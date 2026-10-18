---
title: PyMOL-IMD: PyMOL上でグリグリ触ってMDするInteractive Molecular Dynamicsプラグイン
description: 没研究アイデアその２
pubDate: 2026-10-18
---

All-Atom MM・Coarse-grained・ML/MMの3種類のスケールでIMDができるプラグインを作りました
pixiを使うことですぐに始めることができます
また実験的に覇権分子可視化ツールCueMol3でもIMDができます(こちらはCueMol3のinstallが別途必要)

https://github.com/th2ch-g/pymol_imd

# 経緯
- もともと博士でやろうと思っていた
- ちまちまやっていたが、Claude CodeやCodexの登場でソフトウェアの価値が低下
- そもそも調べるともうすでに既存ツールが結構あった
- 他の仕事が多くなってきた+このツールに愛着もなくなってきたので無理に論文化はせずにネットの海に放つことにした

# Interactive Molecular Dynamics(IMD)
人為的にマウスなどで原子に力を加えてMD計算する分野は、NAMDやVMDがその走りであると認識しています。
最近のブームはVRと組み合わせるみたいな感じです。
MDをせずに、線形応答を使って大規模な動きをDocking的に行うみたいな研究もあってそれに感化されたのと、当時はNNP(MLIP)も流行り始めたぐらいのときでNNPとIMDを組み合わせたら面白いのでは？と思ったのがきっかけでした。

# 実装
基本的には、Visualizer --> Visualizer側の座標の差分からマウスなどによる力を計算しBackendのOpenMMにカスタム外力としてマウスの力を適用 --> OpenMMによるMD計算 --> Visualizer側へ座標を送る、という感じです

スケールが、AAの場合は普通にff14SB, GAFF2, tip3pでMDをし、CGの場合はMartini3をかませてからMDをします、ML/MMの場合は大村くんのML/MM-Toolkitを参考にしてUMAなどのMLIPを使ってOniom方式で計算してMDをします。

AAとML/MMの基本的な機能は人間が実装していたのですが、AI codingの登場からはClaudeCodeやCodexに実装してもらい、ついでにCGやcuemol対応、バグ取りや高速化もしてもらいました。
また最近はcomputer-useによってマウス操作も行えるため「computer-useでデバッグしといて」とだけ伝えて検証もしてもらいました。

個人用ノートPC上で動かす想定でしたがML/MMがかなり遅いため、もし強強なGPUサーバーがあればMD計算はサーバー側で、VisualizeはノートPCで、ということも可能になっています。

# 欠点
- Jarzynskiなどで自由エネルギー計算ができず結局検証止まり
  - SMD/Jarzynskiで計算をしている先行研究があるのでやる前はできると思っていたが、そもそも力をapply→その構造をみて力をapplyとするとそこに情報熱力学的なエネルギーが発生してしまうため単純にJarzynskiなどで計算しても自由エネルギー計算は理論的にはできない(とチャッピーに言われてAGIを感じた、その情報熱力学分のエネルギーをcancelするように理論を組めばいけるかも？)
- すでにIMDツールが多く存在する
- ML/MMの機能も大村くんがすでに開拓済み
- plugin的にpythonを介して通信するためそこまでぬるぬる動くほど速くはない
  - 寄生しているVisualizer側への追加実装が不要だが、その引き換えに遅いです
  - Visualizer(PyMOL, CueMol)に直接OpenMMなどの機能を統合してやる方が速度が出る気がする
- 推論速度が遅すぎてcomputer-useでドラッグしてもすぐ緩和してしまう
  - computer-use x IMDの組み合わせいけるのでは？と試したが無理そうでした
  - 今後推論高速化やcomputer-useの性能が上がればうまく機能するかも
