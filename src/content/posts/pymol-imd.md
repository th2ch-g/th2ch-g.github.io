---
title: "PyMOL-IMD: PyMOL上でグリグリ触ってMDするInteractive Molecular Dynamicsプラグイン"
description: 没研究アイデアその２
pubDate: 2026-10-18
---

All-Atom MM・Coarse-grained・ML/MMの3種類のスケールでIMDができるPyMOL[[1](#ref1)]プラグインを作りました
pixiを使うことですぐに始めることができます
また実験的に覇権分子可視化ツール[CueMol3](https://cuemol.github.io/cuemol3_docs/)でもIMDができます(こちらはCueMol3のinstallが別途必要)

https://github.com/th2ch-g/pymol_imd

# 経緯
- もともと博士でやろうと思っていた
- ちまちまやっていたが、Claude CodeやCodexの登場でソフトウェアの価値が低下
- そもそも調べるともうすでに既存ツールが結構あった
- 他の仕事が多くなってきた+このツールに愛着もなくなってきたので無理に論文化はせずにネットの海に放つことにした

# Interactive Molecular Dynamics(IMD)
人為的にマウスなどで原子に力を加えてMD計算する分野は、NAMDやVMDがその走りであると認識しています[[2](#ref2)]。
最近のブームはNarupaのようにVRと組み合わせるみたいな感じです[[3](#ref3)]。
操作中にMDを逐次実行せず、事前のMDから得た線形応答を使って大規模な動きをDocking的に行うみたいな研究[[4](#ref4)]もあってそれに感化されたのと、当時はNNP(MLIP)も流行り始めたぐらいのときでNNPとIMDを組み合わせたら面白いのでは？と思ったのがきっかけでした。

# 実装
基本的には、Visualizer --> Visualizer側の座標の差分からマウスなどによる力を計算しBackendのOpenMM[[5](#ref5)]にカスタム外力としてマウスの力を適用 --> OpenMMによるMD計算 --> Visualizer側へ座標を送る、という感じです

スケールが、AAの場合は普通にff14SB[[6](#ref6)], GAFF2[[7](#ref7)], TIP3P[[8](#ref8)]またはGBn2[[9](#ref9)]でMDをし、CGの場合はMartini3[[10](#ref10)]をかませてからMDをします、ML/MMの場合は大村くんのML/MM-Toolkit[[11](#ref11)]を参考にしてUMA[[12](#ref12)]などのMLIPを使ってOniom[[13](#ref13)]方式で計算してMDをします。

```bash
# install
git clone https://github.com/th2ch-g/pymol_imd.git
cd pymol_imd
pixi install

# All-atom MM
pixi run pymol_imd local input.pdb --level aa --minimize

# Coarse-grained
pixi run pymol_imd local input.pdb --level cg --minimize

# ML/MM
pixi run pymol_imd local input.pdb --level mlmm --minimize \
    --ml-selection "resi 1" --ml-charge 0 --ml-mult 1
```

AAとML/MMの基本的な機能は人間が実装していたのですが、AI codingの登場からはClaudeCodeやCodexに実装してもらい、ついでにCGやcuemol対応、バグ取りや高速化もしてもらいました。
また最近はcomputer-useによってマウス操作も行えるため「computer-useでデバッグしといて」とだけ伝えて検証もしてもらいました。

個人用ノートPC上で動かす想定でしたがML/MMがかなり遅いため、もし強強なGPUサーバーがあればMD計算はサーバー側で、VisualizeはノートPCで、ということも可能になっています。

```bash
# Server
pixi run pymol_imd serve input.pdb --level aa --minimize \
    --host 0.0.0.0 --port 8888

# Client: copy the server-prepared structure
scp xxx@yyy:path/to/prepared.pdb ./prepared.pdb

# Client: launch PyMOL and connect
pixi run pymol_imd connect prepared.pdb --host yyy --port 8888
```

# 欠点
- 観測に応じて力を変えるIMDでは、通常のJarzynski等式[[14](#ref14)]をそのまま使えず、結局検証止まり
  - SMD/Jarzynskiで計算をしている先行研究[[15](#ref15)]があるのでやる前はできると思っていたが、力をapply→その構造をみて力をapplyとすると観測に応じたフィードバック制御になるため、通常のJarzynski等式をそのまま適用することは一般にはできず、情報量やフィードバックの有効性を含む補正が必要になる[[16](#ref16)](とチャッピーに言われてAGIを感じた、ただ補正に必要な情報を取得できるように組めばいけるかも？)
  - IMDでサンプリング→USでやれば計算できる[[17](#ref17)]があまり本質的ではない
- すでにVMD/NAMD[[2](#ref2)]、Narupa[[3](#ref3)]、ISOLDE[[18](#ref18)]などのIMDツールが多く存在する
- ML/MMの機能も大村くんがすでに開拓済み[[11](#ref11)]
- plugin的にpythonを介して通信するためそこまでぬるぬる動くほど速くはない
  - 寄生しているVisualizer側への追加実装が不要だが、その引き換えに遅いです
  - Visualizer(PyMOL, CueMol)に直接OpenMMなどの機能を統合してやる方が速度が出る気がする
- 推論速度が遅すぎてcomputer-useでドラッグしてもすぐ緩和してしまう
  - computer-use x IMDの組み合わせいけるのでは？と試したが無理そうでした
  - 今後推論高速化やcomputer-useの性能が上がればうまく機能するかも

# 参考文献

<a id="ref1"></a>[1] Schrödinger, LLC. The PyMOL Molecular Graphics System, Version 3.1.0. [Official citation](https://www.pymol.org/support.html#citing) (accessed 2026-10-19).

<a id="ref2"></a>[2] Stone, J. E.; Gullingsrud, J.; Schulten, K.; Grayson, P. A System for Interactive Molecular Dynamics Simulation. *Proceedings of the 2001 Symposium on Interactive 3D Graphics* **2001**, 191–194. DOI: [10.1145/364338.364398](https://doi.org/10.1145/364338.364398)

<a id="ref3"></a>[3] O’Connor, M. B.; et al. Interactive Molecular Dynamics in Virtual Reality from Quantum Chemistry to Drug Binding: An Open-Source Multi-Person Framework. *J. Chem. Phys.* **2019**, *150* (22), 220901. DOI: [10.1063/1.5092590](https://doi.org/10.1063/1.5092590)

<a id="ref4"></a>[4] Iakovou, G.; Laycock, S. D.; Hayward, S. Interactive Flexible-Receptor Molecular Docking in Virtual Reality Using DockIT. *J. Chem. Inf. Model.* **2022**, *62* (23), 5855–5861. DOI: [10.1021/acs.jcim.2c01274](https://doi.org/10.1021/acs.jcim.2c01274)

<a id="ref5"></a>[5] Eastman, P.; et al. OpenMM 8: Molecular Dynamics Simulation with Machine Learning Potentials. *J. Phys. Chem. B* **2024**, *128* (1), 109–116. DOI: [10.1021/acs.jpcb.3c06662](https://doi.org/10.1021/acs.jpcb.3c06662)

<a id="ref6"></a>[6] Maier, J. A.; Martinez, C.; Kasavajhala, K.; Wickstrom, L.; Hauser, K. E.; Simmerling, C. ff14SB: Improving the Accuracy of Protein Side Chain and Backbone Parameters from ff99SB. *J. Chem. Theory Comput.* **2015**, *11* (8), 3696–3713. DOI: [10.1021/acs.jctc.5b00255](https://doi.org/10.1021/acs.jctc.5b00255)

<a id="ref7"></a>[7] Amber. Ligand Force Fields: GAFF2 Force Fields. [Official documentation](https://ambermd.org/AmberModels_organic.php) (accessed 2026-10-19).

<a id="ref8"></a>[8] Jorgensen, W. L.; Chandrasekhar, J.; Madura, J. D.; Impey, R. W.; Klein, M. L. Comparison of Simple Potential Functions for Simulating Liquid Water. *J. Chem. Phys.* **1983**, *79* (2), 926–935. DOI: [10.1063/1.445869](https://doi.org/10.1063/1.445869)

<a id="ref9"></a>[9] Nguyen, H.; Roe, D. R.; Simmerling, C. Improved Generalized Born Solvent Model Parameters for Protein Simulations. *J. Chem. Theory Comput.* **2013**, *9* (4), 2020–2034. DOI: [10.1021/ct3010485](https://doi.org/10.1021/ct3010485)

<a id="ref10"></a>[10] Souza, P. C. T.; et al. Martini 3: A General Purpose Force Field for Coarse-Grained Molecular Dynamics. *Nat. Methods* **2021**, *18* (4), 382–388. DOI: [10.1038/s41592-021-01098-3](https://doi.org/10.1038/s41592-021-01098-3)

<a id="ref11"></a>[11] Ohmura, T.; Inoue, S.; Terada, T. ML/MM Toolkit – Towards Accelerated Mechanistic Investigation of Enzymatic Reactions. *ChemRxiv* **2025** (preprint). DOI: [10.26434/chemrxiv-2025-jft1k](https://doi.org/10.26434/chemrxiv-2025-jft1k)

<a id="ref12"></a>[12] Wood, B. M.; et al. UMA: A Family of Universal Models for Atoms. *Adv. Neural Inf. Process. Syst.* **2025**, *38*. DOI: [10.52202/085713-4310](https://doi.org/10.52202/085713-4310)

<a id="ref13"></a>[13] Svensson, M.; Humbel, S.; Froese, R. D. J.; Matsubara, T.; Sieber, S.; Morokuma, K. ONIOM: A Multilayered Integrated MO + MM Method for Geometry Optimizations and Single Point Energy Predictions. A Test for Diels–Alder Reactions and Pt(P(t-Bu)3)2 + H2 Oxidative Addition. *J. Phys. Chem.* **1996**, *100* (50), 19357–19363. DOI: [10.1021/jp962071j](https://doi.org/10.1021/jp962071j)

<a id="ref14"></a>[14] Jarzynski, C. Nonequilibrium Equality for Free Energy Differences. *Phys. Rev. Lett.* **1997**, *78* (14), 2690–2693. DOI: [10.1103/PhysRevLett.78.2690](https://doi.org/10.1103/PhysRevLett.78.2690)

<a id="ref15"></a>[15] Hummer, G.; Szabo, A. Free Energy Reconstruction from Nonequilibrium Single-Molecule Pulling Experiments. *Proc. Natl. Acad. Sci. U.S.A.* **2001**, *98* (7), 3658–3661. DOI: [10.1073/pnas.071034098](https://doi.org/10.1073/pnas.071034098)

<a id="ref16"></a>[16] Sagawa, T.; Ueda, M. Generalized Jarzynski Equality under Nonequilibrium Feedback Control. *Phys. Rev. Lett.* **2010**, *104* (9), 090602. DOI: [10.1103/PhysRevLett.104.090602](https://doi.org/10.1103/PhysRevLett.104.090602)

<a id="ref17"></a>[17] Deeks, H. M.; Zinovjev, K.; Barnoud, J.; Mulholland, A. J.; van der Kamp, M. W.; Glowacki, D. R. Free Energy along Drug-Protein Binding Pathways Interactively Sampled in Virtual Reality. *Sci. Rep.* **2023**, *13*, 16665. DOI: [10.1038/s41598-023-43523-x](https://doi.org/10.1038/s41598-023-43523-x)

<a id="ref18"></a>[18] Croll, T. I. ISOLDE: A Physically Realistic Environment for Model Building into Low-Resolution Electron-Density Maps. *Acta Crystallogr. D Struct. Biol.* **2018**, *74* (6), 519–530. DOI: [10.1107/S2059798318002425](https://doi.org/10.1107/S2059798318002425)
