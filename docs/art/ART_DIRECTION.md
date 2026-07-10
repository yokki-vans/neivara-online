# Art direction: «Истоки Нейвары»

Монстры, окружение и архитектура в этом каталоге созданы для проекта с нуля.
Игровые гуманоиды построены на открытом CC0-наборе KayKit Adventurers 1.0 и
существенно адаптированы в Blender: оставлены только выбранные классовые вещи и
шесть игровых анимаций, добавлены палитры и пропорции рас, эльфийские уши и
орочьи клыки. Исходники и лицензия находятся в `third_party/kaykit/adventurers`.
Никакие ассеты, логотипы, персонажи, карты или UI существующих MMORPG не
используются.

## Визуальные опоры

- Материалы: речная сталь, чеканная латунь, сланцевая керамика, ясень, тканые ремни, потёртая кожа.
- Палитра: приглушённые teal/olive/umber/slate/indigo; яркие цвета остаются только для читаемости gameplay.
- Силуэты: практичная конструкция, видимые крепления и слои; без гипертрофированных наплечников и «брони-бикини».
- Магия: память Истоков выражается кольцами, минералами и керамическими талисманами, а не заимствованными рунами.

## Runtime assets

| Asset | Назначение |
|---|---|
| `apps/client/public/assets/textures/neivara-ground.jpg` | Повторяемый albedo земли и мха |
| `apps/client/public/assets/textures/neivara-stone-path.jpg` | Повторяемый albedo сланцевой мостовой |
| `apps/client/public/assets/concepts/neivara-character-lineup.jpg` | Архивное раннее clean-room исследование силуэтов; не текущий gameplay roster |
| `apps/client/public/assets/concepts/neivara-equipment-sheet.jpg` | Опорные силуэты оружия и трёх весовых классов брони |
| `apps/client/public/assets/concepts/neivara-character-roster-v2.jpg` | Матрица 5 рас × 2 пола × 2 класса |
| `apps/client/public/assets/concepts/dawnmere-crossing-concept.jpg` | Композиционный ключ стартовой зоны Dawnmere Crossing |
| `apps/client/public/assets/concepts/dawnmere-monsters-sheet.jpg` | Силуэты шести оригинальных существ стартовой зоны |
| `apps/client/public/assets/textures/neivara-character-material-atlas.jpg` | Палитра кожи, ткани, металлов и керамики персонажей |
| `apps/client/public/assets/textures/dawnmere-environment-material-atlas.jpg` | Атлас материалов земли, архитектуры, леса, руин и пещер |
| `apps/client/public/assets/textures/dawnmere/*.jpg` | Пять runtime-тайлов из мастер-атласа для земли, троп, руин и пещер |
| `apps/client/public/assets/models/humanoids/**/*.glb` | 20 адаптированных CC0-персонажей: 5 рас × 2 пола × 2 класса |

PNG-мастера без JPEG-компрессии находятся в `docs/art/source/`.
Хэши мастеров, runtime-производных и имена исходных generation outputs зафиксированы в `docs/art/PROVENANCE.json`.

## Generation prompts

Built-in image generation использовалась для девяти самостоятельных assets. Никакие изображения или файлы Lineage 2 не подавались генератору: сходство ограничено общими жанровыми признаками классической high-fantasy MMORPG.

### Ground

Бесшовная top-down текстура мшистой уплотнённой земли с мелкими минеральными вкраплениями и корневыми волокнами; flat albedo, без теней, предметов, текста и центрального мотива; оригинальный hand-painted stylized realism.

### Stone path

Бесшовная top-down текстура подогнанных сланцево-керамических камней с тонким мхом и редкими латунными ремонтными скобами; flat albedo, без рун, символов, перспективы и baked lighting.

### Character lineup (archived exploration)

Раннее clean-room исследование пяти вымышленных полнофигурных силуэтов с practical layered gear, нейтральными позами и оригинальными лицами и материалами. Этот concept сохранён для provenance, но заменён текущей матрицей люди / светлые эльфы / тёмные эльфы / гномы / орки и не определяет игровой roster 0.3.0.

### Equipment sheet

Двенадцать оригинальных weapon/armor concepts: сабля, тяжёлый клинок, два лука, молот, копьё, посох, жезл, щит и три весовых класса нагрудной брони; студийная подача, читаемые силуэты, без логотипов и заимствованных мотивов.

### Character roster v2

Production roster из двадцати оригинальных героев: люди, светлые эльфы, тёмные эльфы, гномы и орки; для каждой расы показаны мужчина-воин, женщина-воин, мужчина-маг и женщина-маг. Единый stylized-realistic 3D light rig, нейтральные стойки и собственные цветовые семейства: navy/brass, ivory/turquoise, plum/silver, ochre/iron и moss/blackened bronze. Без узнаваемых лиц, костюмов, эмблем, оружия и символов существующих игр.

### Dawnmere Crossing

Широкий aerial concept оригинальной речной стартовой долины: гильдейский двор, кузница, святилище лекаря, мост, учебный круг, безопасные карманы боя, пещера, заросшие руины и сторожевая башня. Читаемая MMO-навигация и самостоятельная архитектура из дерева, штукатурки, сланца и латуни; без копирования реальных локаций и планировок Lineage 2.

### Dawnmere creatures

Creature sheet 3×2: thorn prowler, moss mauler, cave shrieker, ruin sentinel, bramble boar и ember drake. Полный рост, игровые ракурсы, ясные силуэты и функциональная анатомия; без сходства с именованными монстрами или моделями сторонних игр.

### Character material atlas

Flat orthographic albedo atlas: пять самостоятельных семейств кожи рас, navy cloth, ivory silk, plum velvet, ochre wool, кожа, сталь, серебро, бронза, латунь и магическая керамика. Без текста, логотипов, baked lighting и чужих узоров.

### Dawnmere environment material atlas

Flat albedo atlas 4×3: мшистый известняк, тёмный дуб, сланцевая кровля, известковая штукатурка, утоптанная земля, берёзовая кора, речной камень, кузнечное железо, хвоя, синяя ткань знамён, камень руин с корнями и пещерная порода. Без рун, текста, логотипов и baked lighting.

## Следующий art gate

GLB-пакет проходит автоматический gate по всем 20 комбинациям, числу мешей и треугольников, наличию rig, встроенной текстуры и обязательных clips `idle`, `run`, `attack`, `cast`, `hit`, `death`. Следующий art gate — ручная ретопология, LOD0–LOD2, KTX2/Basis и Meshopt перед массовой зоной.
