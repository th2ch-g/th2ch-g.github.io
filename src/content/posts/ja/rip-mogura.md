---
title: 🪦👋 RIP mogura
description: PyMOL-rsが出ていたのでmoguraをそっ閉じました😇
pubDate: 2026-05-12
tags:
  - rust
  - protein
  - molecular-visualizer
  - wasm
  - claudecode
draft: false
heroImage: https://avatars.githubusercontent.com/u/178003195
heroImageAlt: mogumi-chann
---

# mogura: ClaudeCode無き時代にしこしこ作ったRust製Visualizer

https://github.com/mogura-rs/mogura

> MOlecular GRAphic visualizerでmoguraです😃

## モチベーション
当時所属してた研究室では使いにくいと評判の[VMD](https://www.ks.uiuc.edu/Research/vmd/)を使って可視化をしていましたが、あまりに使いにくすぎたので自分で可視化ツールを作りたいなと思っていたので推し言語であるRustで作ってみました。
また博士で志望していた研究室の先生が[オリジナルのvisualizer](https://cuemol.github.io/cuemol2_docs/)を作っていたので舐められないようにと、博士のテーマとしてもやりたいなとも考えていました。(結局効率が悪すぎるのとソフトウェア開発自体がAIでオワコン気味。。。)

## 実装のポイント
ポイントは、

1. Rust製
1. ターミナルとWASMによるブラウザサポート

でした。


と言っても実装したのはまだ最小限で、カメラワークがしにくかったり、タンパク質のcartoon表示などは未対応のままです😇
スター数からもその実装のカスさがお分かりいただけると思います。

当初はWebGPUという新しい規格をRustで実装した[wgpu](https://github.com/gfx-rs/wgpu)というcrateを使って書いていましたがOpenGLなどより設定などが玄人向けで苦労したので、[Bevy](https://github.com/bevyengine/bevy)というECSを採用したゲームエンジンに乗り換えました😭。
結局cameraの実装やPBRなど似た様なことが多いことを考えるとゲームエンジンを採用したのは悪くなかったのかなと勝手に正当化しています。
ただwgpuで一から実装した方がかっこいいしバイナリも小さくなるのでは？と思っています。実際moguraはwasmが19.4 MBありデカく、これでもサイズの最適化などを経ての結果でした。

しかしRustで構造バイオインフォをやっている人はやはり少なく、[pdbtbx](https://github.com/douweschulte/pdbtbx)や[groan_rs](https://github.com/Ladme/groan_rs)など一部やっているコミュニティは存在するのですが、ライブラリ(crate)自体のサポートはPythonやC++に比べて薄いものでした。
なのでGROファイルやPDBファイルを自前でparseまたはwrapする必要があり、ここも苦労した点の一つでした。


# ClaudeCode後、次々と発表されるRust製Visualizer。。。

その後、ClaudeCodeが話題になってから続々とRust製のvisualizerなどが発表されるようになってきました。
特に注目しているのがRustで書き直したPyMOLとターミナル上で可視化可能なProteinViewです。

## PyMOL-rs

https://github.com/zmactep/pymol-rs

PyMOLはC++とPythonで書かれているのですが、これをwgpuを採用したRustで書き直しています。mogura同様にWASMでのサポートも考えているそうです。

## ProteinView

https://github.com/001TMF/ProteinView

元々ターミナルで可視化可能なvisualizerはmmterm-rsなどClaudeCode以前から存在していたのですが、こちらはそれより強そうです(色とか付いていて)。

コレらのツールをみて絶望してmoguraをpublic archiveにしました😇。
さようならわたしの数ヶ月。。。


# ClaudeCodeとCodexで作らせたmdtraj-rsとPDDSP-rsとmmterm-rs

ClaudeCodeがすごすぎるので、自分も有名なMDで使ったりするライブラリなどをRustに書き直させてみました。

https://github.com/mogura-rs/mdtraj-rs

https://github.com/mogura-rs/PyDSSP-rs

https://github.com/mogura-rs/mmterm-rs

スタミナ(Token)が切れてしまったりするので途中でCodexにバトンタッチしたりしたのですが、自分はデバッグしたりするだけでRustで書き直すことができました。
MDtrajはテストケースが公開されていたのでそれを全てPASSするように書かせることでClaudeCodeやCodexが自律的に書き換えをすることができました。
有名なレポジトリではこういったClaudeCodeによる書き換えでランセンスを回避されるのを防ぐためにテストケースを非公開したりするそうです。
mdtraj-rsは外部ツールが必要な機能は意図的に実装していませんが、主要な機能はほぼ使えると思います。
計算に関わるバックエンドを全てRustで実装することによって、Pythonからも利用可能にしつつ、本家のPythonで計算している部分より数桁倍程度高速化することができました。

<details><summary> Benchmark: MDTraj vs MDTraj-rs </summary><div>

| workload | dataset | mdtraj [ms] | mdtraj_rs [ms] | mdtraj_rs speedup |
| --- | --- | ---: | ---: | ---: |
| acylindricity | protein | 3.824 | 0.488 | 7.84x |
| acylindricity | small | 1.328 | 0.170 | 7.79x |
| acylindricity | water | 9.728 | 1.423 | 6.84x |
| asphericity | protein | 3.720 | 0.517 | 7.19x |
| asphericity | small | 1.357 | 0.165 | 8.21x |
| asphericity | water | 9.622 | 1.364 | 7.05x |
| atom_slice | protein | 0.507 | 0.063 | 8.03x |
| atom_slice | small | 0.119 | 0.026 | 4.62x |
| atom_slice | water | 0.705 | 0.120 | 5.86x |
| center_coordinates | protein | 1.414 | 0.245 | 5.78x |
| center_coordinates | small | 0.042 | 0.057 | 0.73x |
| center_coordinates | water | 0.913 | 0.739 | 1.24x |
| compute_angles | protein | 0.599 | 0.259 | 2.31x |
| compute_angles | small | 15.696 | 0.162 | 96.96x |
| compute_angles | water | 4.135 | 1.536 | 2.69x |
| compute_center_of_geometry | protein | 0.777 | 0.143 | 5.45x |
| compute_center_of_geometry | small | 0.851 | 0.018 | 47.25x |
| compute_center_of_geometry | water | 2.337 | 0.347 | 6.73x |
| compute_center_of_mass | protein | 0.303 | 0.124 | 2.44x |
| compute_center_of_mass | small | 0.275 | 0.017 | 16.68x |
| compute_center_of_mass | water | 0.508 | 0.291 | 1.75x |
| compute_chi1 | protein | 1.089 | 0.190 | 5.74x |
| compute_chi1 | small | 0.020 | 0.037 | 0.53x |
| compute_chi1 | water | 0.433 | 0.035 | 12.42x |
| compute_contacts | protein | 3.200 | 1.492 | 2.15x |
| compute_contacts | small | 18.413 | 0.065 | 282.37x |
| compute_contacts | water | 7.271 | 0.563 | 12.90x |
| compute_dihedrals | protein | 0.689 | 0.319 | 2.16x |
| compute_dihedrals | small | 15.815 | 0.170 | 93.03x |
| compute_dihedrals | water | 4.660 | 2.137 | 2.18x |
| compute_displacements | protein | 0.489 | 0.098 | 4.99x |
| compute_displacements | small | 16.276 | 0.151 | 107.82x |
| compute_displacements | water | 3.148 | 0.245 | 12.84x |
| compute_distances | protein | 0.875 | 0.088 | 9.94x |
| compute_distances | small | 19.671 | 0.139 | 141.31x |
| compute_distances | water | 6.211 | 0.231 | 26.90x |
| compute_dssp | protein | 2.611 | 2.642 | 0.99x |
| compute_dssp | small | 0.165 | 0.082 | 2.00x |
| compute_dssp | water | 25.062 | 24.926 | 1.01x |
| compute_gyration_tensor | protein | 3.713 | 0.504 | 7.37x |
| compute_gyration_tensor | small | 1.227 | 0.043 | 28.85x |
| compute_gyration_tensor | water | 9.616 | 1.307 | 7.36x |
| compute_inertia_tensor | protein | 4.386 | 0.538 | 8.16x |
| compute_inertia_tensor | small | 0.591 | 0.046 | 12.90x |
| compute_inertia_tensor | water | 9.872 | 1.288 | 7.67x |
| compute_neighborlist | protein | 5.838 | 5.046 | 1.16x |
| compute_neighborlist | small | 29.159 | 0.040 | 737.43x |
| compute_neighborlist | water | 7.802 | 2.491 | 3.13x |
| compute_neighbors | protein | 5.464 | 5.129 | 1.07x |
| compute_neighbors | small | 29.281 | 0.202 | 144.84x |
| compute_neighbors | water | 16.691 | 16.463 | 1.01x |
| compute_omega | protein | 0.678 | 0.226 | 2.99x |
| compute_omega | small | 0.006 | 0.040 | 0.16x |
| compute_omega | water | 0.089 | 0.076 | 1.17x |
| compute_phi | protein | 0.683 | 0.239 | 2.86x |
| compute_phi | small | 14.410 | 0.059 | 246.14x |
| compute_phi | water | 0.094 | 0.079 | 1.19x |
| compute_psi | protein | 0.673 | 0.244 | 2.76x |
| compute_psi | small | 14.711 | 0.051 | 289.40x |
| compute_psi | water | 0.101 | 0.075 | 1.34x |
| compute_rg | protein | 1.720 | 0.176 | 9.78x |
| compute_rg | small | 0.163 | 0.015 | 10.96x |
| compute_rg | water | 10.127 | 0.412 | 24.59x |
| density | protein | 0.568 | 0.005 | 109.14x |
| density | small | 15.077 | 0.010 | 1470.95x |
| density | water | 3.696 | 0.006 | 611.81x |
| dipole_moments | protein | 2.100 | 0.495 | 4.24x |
| dipole_moments | small | 29.573 | 0.045 | 651.16x |
| dipole_moments | water | 8.073 | 1.210 | 6.67x |
| isothermal_compressability_kappa_T | protein | 0.997 | 0.002 | 556.74x |
| isothermal_compressability_kappa_T | small | 30.103 | 0.012 | 2449.26x |
| isothermal_compressability_kappa_T | water | 7.081 | 0.004 | 1665.90x |
| iterload | protein | 10.019 | 3.783 | 2.65x |
| iterload | small | 0.866 | 0.358 | 2.42x |
| iterload | water | 7.134 | 6.773 | 1.05x |
| load | protein | 9.882 | 3.846 | 2.57x |
| load | small | 0.600 | 0.349 | 1.72x |
| load | water | 7.199 | 6.917 | 1.04x |
| load_frame | protein | 7.940 | 1.090 | 7.29x |
| load_frame | small | 0.285 | 0.064 | 4.42x |
| load_frame | water | 2.716 | 0.342 | 7.95x |
| principal_moments | protein | 3.783 | 0.778 | 4.86x |
| principal_moments | small | 1.296 | 0.166 | 7.82x |
| principal_moments | water | 9.575 | 1.410 | 6.79x |
| relative_shape_anisotropy | protein | 3.730 | 0.542 | 6.88x |
| relative_shape_anisotropy | small | 1.333 | 0.166 | 8.05x |
| relative_shape_anisotropy | water | 9.546 | 1.407 | 6.79x |
| rmsd | protein | 0.098 | 0.072 | 1.36x |
| rmsd | small | 0.172 | 0.099 | 1.75x |
| rmsd | water | 0.647 | 0.418 | 1.55x |
| rmsf | protein | 0.177 | 0.084 | 2.12x |
| rmsf | small | 0.202 | 0.335 | 0.60x |
| rmsf | water | 1.156 | 0.661 | 1.75x |
| save_dcd | protein | 1.602 | 1.706 | 0.94x |
| save_dcd | small | 6.820 | 1.668 | 4.09x |
| save_dcd | water | 8.501 | 4.836 | 1.76x |
| save_gro | protein | 72.271 | 31.016 | 2.33x |
| save_gro | small | 23.015 | 3.433 | 6.70x |
| save_gro | water | 185.562 | 74.037 | 2.51x |
| save_mdcrd | protein | 84.242 | 16.075 | 5.24x |
| save_mdcrd | small | 7.882 | 2.161 | 3.65x |
| save_mdcrd | water | 204.923 | 45.714 | 4.48x |
| save_netcdf | protein | 1.487 | 1.633 | 0.91x |
| save_netcdf | small | 3.665 | 3.311 | 1.11x |
| save_netcdf | water | 6.115 | 5.624 | 1.09x |
| save_pdb | protein | 178.533 | 41.823 | 4.27x |
| save_pdb | small | 31.885 | 4.682 | 6.81x |
| save_pdb | water | 439.748 | 112.515 | 3.91x |
| save_xtc | protein | 2.538 | 1.976 | 1.28x |
| save_xtc | small | 15.379 | 0.455 | 33.80x |
| save_xtc | water | 8.444 | 5.103 | 1.65x |
| shrake_rupley | protein | 636.200 | 579.195 | 1.10x |
| shrake_rupley | small | 17.136 | 15.259 | 1.12x |
| shrake_rupley | water | 1057.973 | 934.829 | 1.13x |
| static_dielectric | protein | 2.612 | 0.494 | 5.28x |
| static_dielectric | small | 45.465 | 0.050 | 915.39x |
| static_dielectric | water | 11.616 | 1.232 | 9.43x |
| superpose | protein | 2.482 | 0.348 | 7.14x |
| superpose | small | 0.364 | 0.400 | 0.91x |
| superpose | water | 4.586 | 1.451 | 3.16x |

</details>


**SaaS is dead**やボトルネックは時間と言われている様に、研究でも相当強いソフトウェアでないと難しいのかなと思いました。
GROMACSとかCPU/GPUなどたくさんの計算リソースが必要なソフトはデバッグが難しいでしょうしまだ安泰かなと思います。
ClaudeCodeが出てから呪術廻戦のナナミンのような気持ちです。
[AI-Scientist](https://www.nature.com/articles/s41586-026-10265-5)もNatureに出版されたし、研究もそのうちClaudeやチャッピーがやるのかなーて感じです😇
人間に残されるのは手法開発、研究の方向付けとかでしょうか。

![それ、ClaudeCodeで良くないですか？](https://assets.st-note.com/production/uploads/images/49809432/picture_pc_625db7e3b3f67f3b4e75ed3233b2f84a.png?width=1200)


