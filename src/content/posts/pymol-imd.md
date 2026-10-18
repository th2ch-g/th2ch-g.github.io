---
title: "PyMOL-IMD: PyMOL上でグリグリ触ってMDするInteractive Molecular Dynamicsプラグイン"
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
人為的にマウスなどで原子に力を加えてMD計算する分野は、NAMDやVMDがその走りであると認識しています[[1](#ref1)]。
最近のブームはVRと組み合わせるみたいな感じです[[2](#ref2)]。
MDをせずに、線形応答を使って大規模な動きをDocking的に行うみたいな研究[[3](#ref3)]もあってそれに感化されたのと、当時はNNP(MLIP)も流行り始めたぐらいのときでNNPとIMDを組み合わせたら面白いのでは？と思ったのがきっかけでした。

# 実装
基本的には、Visualizer --> Visualizer側の座標の差分からマウスなどによる力を計算しBackendのOpenMM[[4](#ref4)]にカスタム外力としてマウスの力を適用 --> OpenMMによるMD計算 --> Visualizer側へ座標を送る、という感じです

スケールが、AAの場合は普通にff14SB[[5](#ref5)], GAFF2, tip3pまたはGBn2でMDをし、CGの場合はMartini3[[6](#ref6)]をかませてからMDをします、ML/MMの場合は大村くんのML/MM-Toolkit[[7](#ref7)]を参考にしてUMA[[8](#ref8)]などのMLIPを使ってOniom[[9](#ref9)]方式で計算してMDをします。

AAとML/MMの基本的な機能は人間が実装していたのですが、AI codingの登場からはClaudeCodeやCodexに実装してもらい、ついでにCGやcuemol対応、バグ取りや高速化もしてもらいました。
また最近はcomputer-useによってマウス操作も行えるため「computer-useでデバッグしといて」とだけ伝えて検証もしてもらいました。

個人用ノートPC上で動かす想定でしたがML/MMがかなり遅いため、もし強強なGPUサーバーがあればMD計算はサーバー側で、VisualizeはノートPCで、ということも可能になっています。

# 欠点
- Jarzynski[[10](#ref10)]などで自由エネルギー計算ができず結局検証止まり
  - SMD/Jarzynskiで計算をしている先行研究[[11](#ref11)]があるのでやる前はできると思っていたが、そもそも力をapply→その構造をみて力をapply[[12](#ref12)]とするとフィードバック制御によって情報熱力学的なエネルギーが発生してしまうため単純にJarzynskiなどで計算しても自由エネルギー計算は理論的にはできない(とチャッピーに言われてAGIを感じた、ただその情報熱力学分のエネルギー分をcancelするように理論を組めばいけるかも？)
- すでにIMDツールが多く存在する[[1](#ref1)][[2](#ref2)][[13](#ref13)]
- ML/MMの機能も大村くんがすでに開拓済み[[7](#ref7)]
- plugin的にpythonを介して通信するためそこまでぬるぬる動くほど速くはない
  - 寄生しているVisualizer側への追加実装が不要だが、その引き換えに遅いです
  - Visualizer(PyMOL, CueMol)に直接OpenMMなどの機能を統合してやる方が速度が出る気がする
- 推論速度が遅すぎてcomputer-useでドラッグしてもすぐ緩和してしまう
  - computer-use x IMDの組み合わせいけるのでは？と試したが無理そうでした
  - 今後推論高速化やcomputer-useの性能が上がればうまく機能するかも

# 参考文献

<a id="ref1"></a>[1] Stone, J. E.; Gullingsrud, J.; Schulten, K. A System for Interactive Molecular Dynamics Simulation. *Proceedings of the 2001 Symposium on Interactive 3D Graphics* **2001**, 191–194. DOI: [10.1145/364338.364398](https://doi.org/10.1145/364338.364398)

<a id="ref2"></a>[2] O’Connor, M. B.; et al. Interactive Molecular Dynamics in Virtual Reality from Quantum Chemistry to Drug Binding: An Open-Source Multi-Person Framework. *J. Chem. Phys.* **2019**, *150* (22), 220901. DOI: [10.1063/1.5092590](https://doi.org/10.1063/1.5092590)

<a id="ref3"></a>[3] Iakovou, G.; Laycock, S. D.; Hayward, S. Interactive Flexible-Receptor Molecular Docking in Virtual Reality Using DockIT. *J. Chem. Inf. Model.* **2022**, *62* (23), 5855–5861. DOI: [10.1021/acs.jcim.2c01274](https://doi.org/10.1021/acs.jcim.2c01274)

<a id="ref4"></a>[4] Eastman, P.; et al. OpenMM 8: Molecular Dynamics Simulation with Machine Learning Potentials. *J. Phys. Chem. B* **2024**, *128* (1), 109–116. DOI: [10.1021/acs.jpcb.3c06662](https://doi.org/10.1021/acs.jpcb.3c06662)

<a id="ref5"></a>[5] Maier, J. A.; Martinez, C.; Kasavajhala, K.; Wickstrom, L.; Hauser, K. E.; Simmerling, C. ff14SB: Improving the Accuracy of Protein Side Chain and Backbone Parameters from ff99SB. *J. Chem. Theory Comput.* **2015**, *11* (8), 3696–3713. DOI: [10.1021/acs.jctc.5b00255](https://doi.org/10.1021/acs.jctc.5b00255)

<a id="ref6"></a>[6] Souza, P. C. T.; et al. Martini 3: A General Purpose Force Field for Coarse-Grained Molecular Dynamics. *Nat. Methods* **2021**, *18* (4), 382–388. DOI: [10.1038/s41592-021-01098-3](https://doi.org/10.1038/s41592-021-01098-3)

<a id="ref7"></a>[7] Ohmura, T.; Inoue, S.; Terada, T. ML/MM Toolkit – Towards Accelerated Mechanistic Investigation of Enzymatic Reactions. *ChemRxiv* **2025** (preprint). DOI: [10.26434/chemrxiv-2025-jft1k](https://doi.org/10.26434/chemrxiv-2025-jft1k)

<a id="ref8"></a>[8] Wood, B. M.; et al. UMA: A Family of Universal Models for Atoms. *Adv. Neural Inf. Process. Syst.* **2025**, *38*. DOI: [10.52202/085713-4310](https://doi.org/10.52202/085713-4310)

<a id="ref9"></a>[9] Svensson, M.; Humbel, S.; Froese, R. D. J.; Matsubara, T.; Sieber, S.; Morokuma, K. ONIOM: A Multilayered Integrated MO + MM Method for Geometry Optimizations and Single Point Energy Predictions. A Test for Diels–Alder Reactions and Pt(P(t-Bu)3)2 + H2 Oxidative Addition. *J. Phys. Chem.* **1996**, *100* (50), 19357–19363. DOI: [10.1021/jp962071j](https://doi.org/10.1021/jp962071j)

<a id="ref10"></a>[10] Jarzynski, C. Nonequilibrium Equality for Free Energy Differences. *Phys. Rev. Lett.* **1997**, *78* (14), 2690–2693. DOI: [10.1103/PhysRevLett.78.2690](https://doi.org/10.1103/PhysRevLett.78.2690)

<a id="ref11"></a>[11] Hummer, G.; Szabo, A. Free Energy Reconstruction from Nonequilibrium Single-Molecule Pulling Experiments. *Proc. Natl. Acad. Sci. U.S.A.* **2001**, *98* (7), 3658–3661. DOI: [10.1073/pnas.071034098](https://doi.org/10.1073/pnas.071034098)

<a id="ref12"></a>[12] Sagawa, T.; Ueda, M. Generalized Jarzynski Equality under Nonequilibrium Feedback Control. *Phys. Rev. Lett.* **2010**, *104* (9), 090602. DOI: [10.1103/PhysRevLett.104.090602](https://doi.org/10.1103/PhysRevLett.104.090602)

<a id="ref13"></a>[13] Croll, T. I. ISOLDE: A Physically Realistic Environment for Model Building into Low-Resolution Electron-Density Maps. *Acta Crystallogr. D Struct. Biol.* **2018**, *74* (6), 519–530. DOI: [10.1107/S2059798318002425](https://doi.org/10.1107/S2059798318002425)

## 関連論文

<a id="ref14"></a>[14] Deeks, H. M.; Zinovjev, K.; Barnoud, J.; Mulholland, A. J.; van der Kamp, M. W.; Glowacki, D. R. Free Energy along Drug-Protein Binding Pathways Interactively Sampled in Virtual Reality. *Sci. Rep.* **2023**, *13*, 16665. DOI: [10.1038/s41598-023-43523-x](https://doi.org/10.1038/s41598-023-43523-x)
