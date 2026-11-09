---
lang: [ja]
title: "Weight-Space Programming法によるBoltz-2の立体化学改善"
description: 簡単な検証
pubDate: 2026-11-05
---

2026/11/3にMITのTakehi氏らによってGPT-6-AstraでQwen3.5-0.8Bの重みを編集させることで数学能力を改善させた、という報告がXで話題となりました。[^1]

そこで、我々の分野でも同じようなことができるかを検証するために生体分子構造予測モデルBoltz-2[^2]の重みを編集させることでリガンドの立体化学の予測構造を改善できないかを簡単に検証させてみました。

結果からいうとあんまり改善できませんでした。

# 背景

AlphaFold3[^3]やBoltzのような構造予測モデルではタンパク質のみならずリガンドの化学構造も予測できるようになりましたが、3-4割程度キラルを間違えてしまうことがわかっています。[^4]

そこで石谷先生らは予測中にあらかじめRdkit[^5]から取得したreference-conformerを元にBond-length, Bond-angle, Chiral-volumeに関するLoss関数を設計し、それに基づいて座標を直接動かすことでこの問題をほぼ解決しました。[^4]

後続の論文ではキラルのみならず、cis-transも対象にしてベンチマークではキラルともに100%の精度を達成できました。[^6]

Boltz-2[^7]やProtenix-v2[^8]にもリガンドの化学構造を正しく出力するためのガイダンス機能が搭載されていますが、我々の検証した限りではキラル、cis-trans、Bond-length RMS、Bond-angle RMSともに拘束誘導推論法には及びませんでした[^6] (ただし、Boltz-2のガイダンスはキラルが100）。
そしてまだMergeされていませんがOpenFold-3にもLigand Chemical Steeringというガイダンス機能が着々と実装されているようです。[^9]

しかしこうしたガイダンス系の方法は根本的な解決ではありません。
本来であればネットワーク自体が最初から正しいリガンドの化学構造を出すことが望ましいです。
そこで、このWeight-Space Programming法によってBoltz-2の出力するリガンドの化学構造を正しく出すように重みをGPT-6-Astraに編集してもらうことにしました。

# 方法

Codexで、GPT-6-Astra xhighにBoltz-2の重みと上記のWeight-Space Programmingの記事[^1]とRGI-Toolkit[^6]のベンチマークで使用した複合体構造のデータセットを渡して、「リガンドの化学構造を改善するようにWeight-Space Programming法で重みを/goalで編集してください」、と依頼しました。

評価は以前の論文[^6]と同じ方法で評価しました。

今回の実験コードは[GitHub](https://github.com/th2ch-g/weight-space-programming-boltz2)、Weight-Space Programmingで編集した全30候補の重みは[Hugging Face](https://huggingface.co/wasarou/weight-space-programming-boltz2)で公開しています。

# 結果

v11ではキラル(R/S)、Bond-length RMS、Bond-angle RMSが若干改善していました。

ただし、E/Zは若干悪化しました。

v11とはAstraによる11番目に作った編集候補です。

表1: 209個での評価結果

| 指標（209個） | 元重み | v11 |
| :--- | ---: | ---: |
| R/S完全一致 | 89/209 | 93/209 |
| E/Z完全一致 | 163/209 | 162/209 |
| 両方が完全一致 | 77/209 | 82/209 |
| 結合長誤差・中央値 | 0.035785 Å | 0.035492 Å |
| 結合角誤差・中央値 | 2.6590° | 2.6327° |

※ 209個には重みの編集・候補選択に使った55個も含まれ、それ以外の154個に限るとR/S完全一致は68→69、両方が完全一致は57→59で、差はほぼ誤差の範囲でした。

この後も30回程度まで編集をしていましたが、一番結果がバランス的によかったのはこのv11でした。

# 考察
本実験によってGPT-6-Astraが直接重みを編集することでリガンドの化学構造をほんの少しだけ改善されました。
しかしながら、E/Zは若干悪化してしまっていました。
結果から見るとこのタスクにはあんまり効果はなさそうでした。
元記事では推論ループがバグっていたQwen3.5-0.8Bでは効果的であったが、ループが少ないGemma3にはあまり効果がなかったとのことで[^1]、場面に応じて使い分けた方が良い方法なのではないかと思いました。
今回のケースでは、Weight-Space Programming法で行うのではなく、無難に追加学習したりアーキテクチャを少し変えた方が効率的なのかなと思いました。

ちなみに、ログを眺めていると、Astraがリガンドの化学構造に関わる層を特定しようとしているのが面白かったです。

> 参照形状を伝える経路は、実測でも他の経路より弱いことを確認しました。現在、その経路だけを強めた2候補を比較しています。併せて、リガンド原子名の信号が座標情報に干渉する可能性を調べる候補も作成しました。

> 別の経路として、二重結合の種類を表す重みが見つかりました。この経路なら参照座標全体を変えずに結合の情報を強められるため、まず開発55系で、その入力がリガンドのみに適用されるか確認しています。

> 経路を分けた診断では、どちらを鏡像に替えても30中心のR/Sは変わりませんでした。特に座標生成側の参照座標重みは入力側の約千分の一で、出力の変化も小さく、この経路が立体配置をほとんど伝えていないことを示しています。

> R/Sの悪化は複数の化学構造に分散しており、単一の原子種だけを直す方針では足りません。参照構造は入力側と座標生成側の2経路で使われるため、片方ずつ鏡像に替える診断で、どちらが立体配置の決定に寄与するか調べます。


# 参考文献

[^1]: Takehi, R., Teoh, J., Zhang, A., & Khattab, O. (2026, November 2). [Sparks of Weight-Space Programming: LLMs can natively read & write neural network weights](https://rikiyat.github.io/blog/weight-space-programming/). Blog post. [Related X post by Rikiya Takehi](https://x.com/rikiyatakehi/status/2117313742891327994).

[^2]: Passaro, S., Corso, G., Wohlwend, J., et al. (2025). [Boltz-2: Towards Accurate and Efficient Binding Affinity Prediction](https://doi.org/10.1101/2025.06.14.659707). *bioRxiv*, preprint.

[^3]: Abramson, J., Adler, J., Dunger, J., et al. (2024). [Accurate structure prediction of biomolecular interactions with AlphaFold 3](https://doi.org/10.1038/s41586-024-07487-w). *Nature*, 630, 493–500.

[^4]: Ishitani, R., & Moriwaki, Y. (2025). [Improving Stereochemical Limitations in Protein–Ligand Complex Structure Prediction](https://pubs.acs.org/acsodf/article/10/46/56075/3659006/Improving-Stereochemical-Limitations-in-Protein). *ACS Omega*, 10(46), 56075–56084. DOI: [10.1021/acsomega.5c07675](https://doi.org/10.1021/acsomega.5c07675). The reported 30–40% chirality error rates concern AlphaFold3 and Boltz-1 on the study's chiral-ligand datasets.

[^5]: RDKit contributors. [RDKit: Open-Source Cheminformatics Software](https://www.rdkit.org/). Software and documentation. Accessed November 5, 2026.

[^6]: Hori, T., Moriwaki, Y., & Ishitani, R. (2026). [RGI-Toolkit: Differentiable Restraints for Controllable Biomolecular Structure Prediction](https://www.biorxiv.org/content/10.64898/2026.10.05.756905). *bioRxiv*, preprint. DOI: [10.64898/2026.10.05.756905](https://doi.org/10.64898/2026.10.05.756905). [Official repository](https://github.com/cddlab/rgi_toolkit).

[^7]: Boltz contributors. [Prediction](https://github.com/jwohlwend/boltz/blob/main/docs/prediction.md). Official documentation, including inference-time potentials (`--use_potentials`). Accessed November 5, 2026.

[^8]: ByteDance. (2026). [Protenix-v2 Technical Report](https://github.com/bytedance/Protenix/blob/main/docs/PX2.pdf). Technical report. [Release v2.0.0: Protenix-v2 Model Released](https://github.com/bytedance/Protenix/releases/tag/v2.0.0), including Training-Free Guidance. Accessed November 5, 2026.

[^9]: Obi, P. (2026). [Ligand chemical steering](https://github.com/aqlaboratory/openfold-3/pull/385). *OpenFold-3*, GitHub pull request #385. Accessed November 5, 2026.
