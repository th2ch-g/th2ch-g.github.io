---
title: 構造予測ベースのサンプリング手法まとめ2026夏
description: もうMDは卒業。。。🎓
pubDate: 2026-06-24
tags:
  - protein
  - conformational-sampling
  - review
draft: false
heroImage:
heroImageAlt:
---

分類は、1. 入力するMSAを改変、2. MSA特徴量を改変、3. 3次元座標を改変、4. アンサンブルそのものを生成、をそれぞれ示す。


| 手法名 | 分類 | 主な執筆者と所属 | 何をするか | 方法 | メリット | デメリット | DOI |
|---|---|---|---|---|---|---|---|
| **AF2 MSAサブサンプリング** (af2_conformations) | 1 | D. del Alamo, D. Sala, H. Mchaourab, J. Meiler / Vanderbilt大・Leipzig大 | 膜タンパク質(トランスポーター/GPCR)の代替コンフォメーションをサンプリング | 入力MSAの深さを確率的サブサンプリングで浅く(16配列〜)+recycle=1+多数モデル生成しPCAで両端を選択 | 単純・追加学習不要、2状態間の中間構造もサンプル、実験構造とRMSF相関 | 最適MSA深さがタンパク質依存、訓練セット内構造には効果薄、誤フォールドも生成 | 10.7554/eLife.75751 |
| **AF-Cluster** | 1 | H. Wayment-Steele, S. Ovchinnikov, L. Colwell, D. Kern / Brandeis大・HHMI, Harvard, Google Research | メタモルフィック(fold-switch)タンパク質の代替状態を高信頼度で予測 | MSAを配列類似度でDBSCANクラスタリングし各クラスタを個別にAF2へ入力、NMRで検証 | fold-switchの両状態を高信頼度予測、進化的分布を解析可能 | ランダムサンプリングに劣るとの批判(Matters Arising)、plDDTが正誤を確実に区別せず、適用範囲限定 | 10.1038/s41586-023-06832-9 |
| **SPEACH_AF** | 1 | R. Stein, H. Mchaourab / Vanderbilt大 | AF2で代替コンフォメーション・アンサンブルをモデリング(特に膜タンパク質) | MSAのin silico変異導入。スライディングウィンドウでカラムをアラニン置換し共進化シグナルを破壊 | 一般的手法、デフォルトで見えない状態を露出 | 相互作用残基or片方の状態の事前知識が必要、計算コスト | 10.1371/journal.pcbi.1010483 |
| **AFsample2** | 1 | Y. Kalakoti, B. Wallner / Linköping大(スウェーデン) | AF2で代替状態・アンサンブル・中間状態を予測 | MSAのカラムをランダムに"X"でマスクし共進化を希釈。AFコードに統合し各モデルで異なるマスク+dropout、1000モデル | 事前知識不要(SPEACH_AFと違い)、終/中間状態とも改善、不要な多様性は出さない | 最適マスク率がタンパク質依存、confidenceが代替状態選択に不適、fold-switch限定的、モノマーのみ検証 | 10.1038/s42003-025-07791-9 |
| **AFsample2T** | 1 | N. Mitjavila-Domènech ほか, B. Wallner, J. Carlsson / Uppsala大・Linköping大 | GPCR標的のバーチャルスクリーニングでAF2を改善、結合部位の複数コンフォメーションを生成 | AFsample2(MSAカラムマスキング)にテンプレートを組合せ、結合部位アンサンブル+ドッキング | 複数の結合部位コンフォメーションを捕捉、実験的変動を再現、VS性能向上 | GPCR特化、テンプレート依存、ドッキング下流用途 | 10.1021/acs.jcim.6c00034 |
| **AFsample** | 2 | B. Wallner / Linköping大 | マルチマー予測改善(副次的に代替コンフォメーション/柔軟構造) | 推論時にdropoutを有効化し内部表現を確率的に摂動+大量サンプリング(~6000/ターゲット)、v1/v2重み・recycle増 | CASP15マルチマー1位、DockQ 0.41→0.55、単純で導入容易 | 計算コスト膨大(~1000倍)、主にマルチマー向け、選択が難しい場合あり | 10.1093/bioinformatics/btad573 |
| **SteerAF** | 2 | J. Tang, Z. Zhu, S. Yang, C. Song / 北京大学・福州大学 | AF2/OpenFoldを推論時に誘導し代替コンフォメーションを予測、機能残基も同定 | distogramの代替状態シグナルを利用し、MSA特徴量をhallucination的に勾配上昇(block gradient ascent)で更新、重み固定 | 少数サンプル(10–20 run)で効率的、解釈可能(機能残基と相関~50%精度)、reference-free選択85%、MD種に利用可 | fold-switch・3状態以上は苦手、勾配収束問題、プレプリント | 10.64898/2026.06.19.733296 (bioRxiv) |
| **ConforNets** | 2 | M. Lee ほか, M. AlQuraishi / Columbia大 | AF3/OpenFold3で代替コンフォメーションを生成・制御、ファミリー間のconformational transferも | AF3のpre-Pairformerペア潜在表現にchannel-wiseアフィン変換を適用、摂動の最適位置・方法を探索しグローバルに変調 | 既存マルチ状態ベンチでSOTA、タンパク質間で再利用可、教師ありconformational transfer | AF3/OpenFold3特化、潜在表現操作で解釈性低め、プレプリント | 10.48550/arXiv.2604.18559 |
| **Boltz-sample** (Pair Representation Scaling) | 2 | S. Suzuki, T. Amagasa / 筑波大学 | Boltz-2でコンフォメーションサンプリングを系統的に誘導、代替状態・アンサンブルカバレッジ改善 | 潜在ペア表現を単一スカラーβで一様リスケール z=(1+β)z。Pairformer入力で適用しペアカップリング強度を調整(β>0拘束強化/β<0緩和)、配列・MSA・重み不変 | 解釈可能な単一パラメータ、MSA無しでも構造プライアを引き出す、クラスタリング不要(confidence選択) | Boltz-2特化、βスイープ必要、プレプリント | 10.64898/2026.01.23.701250 (bioRxiv) |
| **Distance-AF** | 3 | Y. Zhang, G. Terashi, D. Kihara ほか / Purdue大・上海交通大学 | ユーザー指定の距離拘束でAF2モデルを改善。ドメイン配向修正/active-inactive/cryo-EMフィット/NMRアンサンブル生成 | AF2のstructure module内で距離拘束をloss項として追加、反復最適化(オーバーフィット機構、事前学習不要)で座標を更新 | 少数拘束(~6個)で大きなドメイン移動、Rosetta/AlphaLinkを上回る、cryo-EM/NMR/仮説検証に応用、事前学習不要 | 距離拘束が必要、回転調整は苦手(ヒンジは得意)、molprobity悪化(MD緩和で改善)、ターゲット毎に最適化 | 10.1038/s42003-025-08783-5 |
| **距離拘束ガイド拡散** (boltz_restr) | 3 | T. Hori, Y. Moriwaki, R. Ishitani / 東京科学大学 | コンフォメーション変化・リガンド解離経路を系統的にサンプリング、指定状態を予測 | AF3様拡散モデル(Boltz-2)の逆拡散過程で原子グループ間の重心間距離を拘束、再学習不要で反応座標に沿いサンプル | MSA操作法より均一なコンフォメーション空間カバレッジ、再学習不要、リガンド解離経路もサンプル、熱力学的特徴づけ | 反応座標(距離拘束)の事前指定が必要、3タンパク質での実証、PoC段階 | 10.1021/acs.jctc.6c00199 |
| **AF3-ReD** | 3 | J. Ohnuki, K. Okazaki / 分子科学研究所(NINS) | AF3で複数コンフォメーション(元のAF3が捕捉できないモーター/トランスポーターのリガンド結合型など)を予測 | AF3拡散モデルのscore function(対数確率密度の勾配)に反発バイアスポテンシャルを加え逆拡散過程を摂動 | 元のAF3が出せない結合コンフォメーションも予測、再学習不要、他の拡散モデルにも応用可 | バイアスポテンシャル設計が必要、特定系での実証、プレプリント | 10.64898/2025.12.17.693105 (bioRxiv) |
| **BioEmu** (Biomolecular Emulator) | 4 | S. Lewis, C. Clementi, F. Noé ほか / Microsoft Research AI for Science・ベルリン自由大学・Rice大 | タンパク質の平衡(equilibrium)アンサンブルを高速生成、構造変化・自由エネルギーを予測 | 生成的深層学習(拡散ベース)。200ms超のMD+実験データで訓練、GPU1枚で1時間に数千の独立構造 | MDの数桁高速、cryptic pocket形成・局所アンフォールディング・ドメイン再配置を捕捉、相対自由エネルギーを~1 kcal/mol精度 | 訓練データ(MD/実験)に依存、MDエミュレーションで新規物理は学習せず、系により精度限界 | 10.1126/science.adv9817 |


> Claudeにまとめさせました
