const studies = [
  {
    id: "1.2.840.113619.2.55.3.604688433.781.1718622241.467",
    patientName: "Ayse Demir",
    patientId: "PAT-48291",
    accessionNumber: "ACC-2026-0617-018",
    modality: "MR",
    bodyPart: "Beyin",
    description: "MR Beyin kontrastli",
    date: "17.06.2026",
    time: "09:42",
    age: 54,
    sex: "K",
    institution: "RAI Klinik Goruntuleme",
    physician: "Dr. Selin Aras",
    priority: "Acil",
    status: "Okunacak",
    series: [
      ["AX T2 FSE", 32, "18/32", "W: 80 L: 40"],
      ["DWI b1000", 24, "11/24", "W: 120 L: 60"],
      ["T1 kontrast", 30, "15/30", "W: 90 L: 45"],
    ],
    findings: [
      "DWI serisinde akut difuzyon kisitlanmasi izlenmedi.",
      "Kontrast sonrasi belirgin patolojik tutulum saptanmadi.",
      "Ventrikul boyutlari yas ile uyumludur.",
    ],
  },
  {
    id: "1.2.840.10008.5.1.4.1.1.2.20260617.734",
    patientName: "Mehmet Kaya",
    patientId: "PAT-18304",
    accessionNumber: "ACC-2026-0617-024",
    modality: "BT",
    bodyPart: "Toraks",
    description: "BT Toraks dusuk doz",
    date: "17.06.2026",
    time: "10:18",
    age: 61,
    sex: "E",
    institution: "RAI Klinik Goruntuleme",
    physician: "Dr. Murat Onal",
    priority: "Rutin",
    status: "Raporlanıyor",
    series: [
      ["Akciger penceresi", 248, "132/248", "W: 1500 L: -600"],
      ["Mediasten penceresi", 248, "132/248", "W: 400 L: 40"],
    ],
    findings: [
      "Her iki akciger parankiminde belirgin konsolidasyon izlenmedi.",
      "Mediastinal patolojik boyutta lenf nodu saptanmadi.",
      "Plevral efüzyon bulgusu yoktur.",
    ],
  },
  {
    id: "1.2.826.0.1.3680043.8.498.20260617.922",
    patientName: "Zeynep Celik",
    patientId: "PAT-77120",
    accessionNumber: "ACC-2026-0617-031",
    modality: "US",
    bodyPart: "Abdomen",
    description: "USG Tum abdomen",
    date: "17.06.2026",
    time: "11:05",
    age: 38,
    sex: "K",
    institution: "Mobil Tarama Unitesi",
    physician: "Dr. Deniz Aksoy",
    priority: "Kontrol",
    status: "Tamamlandı",
    series: [
      ["Karaciger", 18, "7/18", "Gain: 62%"],
      ["Bobrekler", 16, "9/16", "Gain: 58%"],
    ],
    findings: [
      "Karaciger boyutu ve parankim ekojenitesi normal sinirlardadir.",
      "Safra kesesinde tas lehine bulgu izlenmedi.",
      "Her iki bobrekte hidronefroz saptanmadi.",
    ],
  },
  {
    id: "1.2.840.113704.1.111.20260617.515",
    patientName: "Can Yilmaz",
    patientId: "PAT-24550",
    accessionNumber: "ACC-2026-0617-039",
    modality: "DX",
    bodyPart: "Akciger",
    description: "PA Akciger grafisi",
    date: "17.06.2026",
    time: "12:21",
    age: 46,
    sex: "E",
    institution: "RAI Klinik Goruntuleme",
    physician: "Dr. Ece Kiraz",
    priority: "Rutin",
    status: "Okunacak",
    series: [["PA projeksiyon", 1, "1/1", "W: 2048 L: 1024"]],
    findings: [
      "Kardiyotorasik oran normal sinirlardadir.",
      "Akciger alanlarinda belirgin infiltrasyon izlenmedi.",
      "Kostofrenik sinusler aciktir.",
    ],
  },
  {
    id: "1.2.840.113619.2.312.4120.20260617.601",
    patientName: "Elif Arslan",
    patientId: "PAT-56012",
    accessionNumber: "ACC-2026-0617-044",
    modality: "MR",
    bodyPart: "Lomber",
    description: "MR Lomber omurga",
    date: "17.06.2026",
    time: "12:48",
    age: 42,
    sex: "K",
    institution: "RAI Klinik Goruntuleme",
    physician: "Dr. Hakan Sener",
    priority: "Rutin",
    status: "Okunacak",
    series: [
      ["Sag T2", 28, "14/28", "W: 90 L: 45"],
      ["Sag T1", 24, "12/24", "W: 85 L: 42"],
      ["Ax T2 L4-S1", 36, "20/36", "W: 95 L: 48"],
    ],
    findings: [
      "L4-5 duzeyinde posterior annuler bulging izlenmektedir.",
      "Belirgin santral kanal darligi saptanmadi.",
      "Konus medullaris seviyesi normal lokalizasyondadir.",
    ],
  },
  {
    id: "1.2.840.10008.5.1.4.1.1.2.20260617.802",
    patientName: "Omer Sahin",
    patientId: "PAT-90417",
    accessionNumber: "ACC-2026-0617-052",
    modality: "BT",
    bodyPart: "Beyin",
    description: "BT Beyin acil",
    date: "17.06.2026",
    time: "13:06",
    age: 72,
    sex: "E",
    institution: "Acil Servis Goruntuleme",
    physician: "Dr. Nihan Er",
    priority: "Acil",
    status: "Raporlanıyor",
    series: [
      ["Axial kemik", 86, "43/86", "W: 2500 L: 500"],
      ["Axial parankim", 86, "43/86", "W: 80 L: 40"],
      ["Coronal MPR", 64, "31/64", "W: 80 L: 40"],
    ],
    findings: [
      "Akut intrakraniyal hemoraji lehine bulgu izlenmedi.",
      "Orta hat yapilarinda saptanabilir shift yoktur.",
      "Yaygin kortikal atrofi yas ile uyumludur.",
    ],
  },
  {
    id: "1.2.826.0.1.3680043.10.543.20260617.615",
    patientName: "Nazli Korkmaz",
    patientId: "PAT-31876",
    accessionNumber: "ACC-2026-0617-058",
    modality: "MG",
    bodyPart: "Meme",
    description: "Bilateral mamografi",
    date: "17.06.2026",
    time: "13:33",
    age: 49,
    sex: "K",
    institution: "RAI Kadın Sagligi Birimi",
    physician: "Dr. Ipek Yalcin",
    priority: "Kontrol",
    status: "Okunacak",
    series: [
      ["R CC", 1, "1/1", "W: 3200 L: 1600"],
      ["L CC", 1, "1/1", "W: 3200 L: 1600"],
      ["R MLO", 1, "1/1", "W: 3200 L: 1600"],
      ["L MLO", 1, "1/1", "W: 3200 L: 1600"],
    ],
    findings: [
      "Bilateral fibroglanduler dansite heterojen paterndedir.",
      "Spikule konturlu kitle ya da supheli mikrokalsifikasyon izlenmedi.",
      "Karsilastirma icin onceki incelemeler onerilir.",
    ],
  },
  {
    id: "1.2.840.113704.7.223.20260617.701",
    patientName: "Kerem Aydin",
    patientId: "PAT-69902",
    accessionNumber: "ACC-2026-0617-063",
    modality: "DX",
    bodyPart: "Ayak bilegi",
    description: "Sol ayak bilegi grafisi",
    date: "17.06.2026",
    time: "14:02",
    age: 27,
    sex: "E",
    institution: "Ortopedi Goruntuleme",
    physician: "Dr. Alp Gunes",
    priority: "Acil",
    status: "Tamamlandı",
    series: [
      ["AP", 1, "1/1", "W: 2200 L: 1100"],
      ["Lateral", 1, "1/1", "W: 2200 L: 1100"],
    ],
    findings: [
      "Akut deplase fraktur hattı izlenmedi.",
      "Tibiotalar eklem iliskisi korunmustur.",
      "Yumusak doku sisligi lateral malleol komsulugunda belirgindir.",
    ],
  },
  {
    id: "1.2.840.10008.5.1.4.1.1.2.20260617.871",
    patientName: "Fatma Ozkan",
    patientId: "PAT-12088",
    accessionNumber: "ACC-2026-0617-071",
    modality: "BT",
    bodyPart: "Abdomen",
    description: "BT Abdomen kontrastli",
    date: "17.06.2026",
    time: "14:27",
    age: 66,
    sex: "K",
    institution: "RAI Klinik Goruntuleme",
    physician: "Dr. Canan Bilgin",
    priority: "Rutin",
    status: "Okunacak",
    series: [
      ["Portal venoz faz", 312, "156/312", "W: 400 L: 50"],
      ["Koronal reformasyon", 118, "58/118", "W: 400 L: 50"],
      ["Sagittal reformasyon", 96, "41/96", "W: 400 L: 50"],
    ],
    findings: [
      "Karacigerde fokal solid lezyon izlenmedi.",
      "Safra yollarinda dilatasyon saptanmadi.",
      "Batinda serbest sivi ya da belirgin lenfadenopati yoktur.",
    ],
  },
  {
    id: "1.2.840.113619.9.44.20260617.432",
    patientName: "Derya Polat",
    patientId: "PAT-87544",
    accessionNumber: "ACC-2026-0617-079",
    modality: "MR",
    bodyPart: "Diz",
    description: "MR Sag diz",
    date: "17.06.2026",
    time: "15:01",
    age: 35,
    sex: "K",
    institution: "Spor Hekimligi Goruntuleme",
    physician: "Dr. Bora Ince",
    priority: "Kontrol",
    status: "Raporlanıyor",
    series: [
      ["PD FS Sag", 30, "15/30", "W: 100 L: 50"],
      ["Cor PD", 28, "12/28", "W: 100 L: 50"],
      ["Ax PD FS", 24, "10/24", "W: 100 L: 50"],
    ],
    findings: [
      "Medial meniskus posterior hornunda grade 2 sinyal artisi izlenmektedir.",
      "On capraz bag kontinuitesi korunmustur.",
      "Eklem ici minimal efüzyon mevcuttur.",
    ],
  },
  {
    id: "1.2.826.0.1.3680043.8.498.20260617.984",
    patientName: "Seda Guler",
    patientId: "PAT-44519",
    accessionNumber: "ACC-2026-0617-083",
    modality: "US",
    bodyPart: "Tiroid",
    description: "Tiroid USG",
    date: "17.06.2026",
    time: "15:26",
    age: 44,
    sex: "K",
    institution: "Endokrinoloji Goruntuleme",
    physician: "Dr. Merve Tas",
    priority: "Rutin",
    status: "Tamamlandı",
    series: [
      ["Sag lob", 14, "6/14", "Gain: 55%"],
      ["Sol lob", 16, "9/16", "Gain: 57%"],
      ["Doppler", 10, "4/10", "PRF: 4.2"],
    ],
    findings: [
      "Tiroid parankimi heterojen eko yapidadir.",
      "Sol lobda 8 mm solid izoekoik nodul izlenmektedir.",
      "Patolojik boyutta servikal lenf nodu saptanmadi.",
    ],
  },
  {
    id: "1.2.840.113704.6.552.20260617.311",
    patientName: "Ali Tunc",
    patientId: "PAT-23771",
    accessionNumber: "ACC-2026-0617-090",
    modality: "CR",
    bodyPart: "Servikal",
    description: "Servikal grafi AP lateral",
    date: "17.06.2026",
    time: "16:04",
    age: 58,
    sex: "E",
    institution: "RAI Klinik Goruntuleme",
    physician: "Dr. Cenk Ozturk",
    priority: "Rutin",
    status: "Okunacak",
    series: [
      ["AP", 1, "1/1", "W: 2100 L: 1050"],
      ["Lateral", 1, "1/1", "W: 2100 L: 1050"],
    ],
    findings: [
      "Servikal lordozda duzlesme izlenmektedir.",
      "C5-6 ve C6-7 duzeylerinde spondilotik degisiklikler mevcuttur.",
      "Prevertebral yumusak doku kalinligi normaldir.",
    ],
  },
  {
    id: "1.2.840.10008.5.1.4.1.1.2.20260617.944",
    patientName: "Mina Kaplan",
    patientId: "PAT-91035",
    accessionNumber: "ACC-2026-0617-097",
    modality: "BT",
    bodyPart: "Sinus",
    description: "BT Paranazal sinus",
    date: "17.06.2026",
    time: "16:38",
    age: 31,
    sex: "K",
    institution: "KBB Goruntuleme",
    physician: "Dr. Eren Koc",
    priority: "Kontrol",
    status: "Tamamlandı",
    series: [
      ["Axial kemik", 124, "60/124", "W: 2500 L: 500"],
      ["Coronal MPR", 92, "42/92", "W: 2500 L: 500"],
    ],
    findings: [
      "Maksiller sinuslerde mukozal kalinlasma izlenmektedir.",
      "Ostiomeatal kompleksler bilateral aciktir.",
      "Kemik destruksiyonu lehine bulgu yoktur.",
    ],
  },
  {
    id: "1.2.840.113619.2.290.9.20260617.715",
    patientName: "Burak Eren",
    patientId: "PAT-50268",
    accessionNumber: "ACC-2026-0617-104",
    modality: "MR",
    bodyPart: "Omuz",
    description: "MR Sol omuz",
    date: "17.06.2026",
    time: "17:09",
    age: 39,
    sex: "E",
    institution: "Ortopedi Goruntuleme",
    physician: "Dr. Alp Gunes",
    priority: "Rutin",
    status: "Okunacak",
    series: [
      ["Cor PD FS", 26, "13/26", "W: 100 L: 50"],
      ["Sag T1", 22, "11/22", "W: 90 L: 45"],
      ["Ax PD", 24, "10/24", "W: 100 L: 50"],
    ],
    findings: [
      "Supraspinatus tendonunda tendinozis ile uyumlu sinyal artisi mevcuttur.",
      "Tam kat rotator cuff yirtigi izlenmedi.",
      "Subakromial-subdeltoid bursada minimal sivi izlenmektedir.",
    ],
  },
  {
    id: "1.2.840.10008.5.1.4.1.1.12.20260617.219",
    patientName: "Hasan Demirtas",
    patientId: "PAT-73328",
    accessionNumber: "ACC-2026-0617-112",
    modality: "XA",
    bodyPart: "Koroner",
    description: "Koroner anjiyografi",
    date: "17.06.2026",
    time: "17:44",
    age: 64,
    sex: "E",
    institution: "Kardiyoloji Lab",
    physician: "Dr. Tamer Sayin",
    priority: "Acil",
    status: "Raporlanıyor",
    series: [
      ["LCA RAO caudal", 146, "72/146", "Frame: 15 fps"],
      ["LCA LAO cranial", 132, "66/132", "Frame: 15 fps"],
      ["RCA LAO", 118, "58/118", "Frame: 15 fps"],
    ],
    findings: [
      "LAD proksimal segmentte belirgin darlik suphelidir.",
      "RCA akim paterni korunmustur.",
      "Klinik ve kateter raporu ile birlikte degerlendirilmelidir.",
    ],
  },
  {
    id: "1.2.826.0.1.3680043.8.498.20260617.117",
    patientName: "Yagmur Bilal",
    patientId: "PAT-66801",
    accessionNumber: "ACC-2026-0617-119",
    modality: "US",
    bodyPart: "Obstetrik",
    description: "Obstetrik USG 2. trimester",
    date: "17.06.2026",
    time: "18:12",
    age: 29,
    sex: "K",
    institution: "RAI Kadın Sagligi Birimi",
    physician: "Dr. Ipek Yalcin",
    priority: "Kontrol",
    status: "Okunacak",
    series: [
      ["Biyometri", 22, "10/22", "Gain: 60%"],
      ["Anatomi", 28, "16/28", "Gain: 62%"],
      ["Doppler", 12, "5/12", "PRF: 3.8"],
    ],
    findings: [
      "Tek canli intrauterin gebelik izlenmektedir.",
      "Fetal kalp aktivitesi mevcuttur.",
      "Biyometrik olcumler klinik hafta ile uyumludur.",
    ],
  },
]

const state = {
  modality: "Tümü",
  query: "",
  selectedId: studies[0].id,
}

const $ = (selector) => document.querySelector(selector)

const modalities = ["Tümü", ...new Set(studies.map((study) => study.modality))]

function normalized(value) {
  return value.toLocaleLowerCase("tr-TR")
}

function filteredStudies() {
  return studies.filter((study) => {
    const matchesModality =
      state.modality === "Tümü" || study.modality === state.modality
    const haystack = normalized(
      [
        study.patientName,
        study.patientId,
        study.accessionNumber,
        study.description,
        study.bodyPart,
        study.physician,
      ].join(" ")
    )
    return matchesModality && haystack.includes(normalized(state.query))
  })
}

function selectedStudy() {
  return studies.find((study) => study.id === state.selectedId) || studies[0]
}

function renderTabs() {
  $("#modality-tabs").innerHTML = modalities
    .map(
      (modality) =>
        `<button type="button" class="${modality === state.modality ? "is-active" : ""}" data-modality="${modality}">${modality}</button>`
    )
    .join("")
}

function renderStudyList() {
  const rows = filteredStudies()
    .map(
      (study) => `
        <button type="button" class="study-row ${study.id === state.selectedId ? "is-selected" : ""}" data-study-id="${study.id}">
          <div class="modality-badge">${study.modality}</div>
          <div>
            <h3>${study.patientName}</h3>
            <p>${study.patientId} · ${study.age}${study.sex} · ${study.accessionNumber}</p>
            <footer>
              <span>${study.description}</span>
              <span class="priority ${study.priority.toLocaleLowerCase("tr-TR")}">${study.priority}</span>
            </footer>
          </div>
        </button>
      `
    )
    .join("")

  $("#study-list").innerHTML =
    rows || `<div class="finding">Bu filtrelerle çalışma bulunamadı.</div>`
}

function renderStudy() {
  const study = selectedStudy()
  $("#patient-name").textContent = study.patientName
  $("#study-summary").textContent =
    `${study.patientId} · ${study.age} yaş · ${study.sex} · ${study.description} · ${study.physician}`
  $("#study-date").textContent = `${study.date} ${study.time}`
  $("#study-modality").textContent = study.modality
  $("#study-series-count").textContent = study.series.length
  $("#study-status").textContent = study.status
  $("#series-total").textContent = study.series.length

  $("#series-list").innerHTML = study.series
    .map(
      (series) => `
        <article class="series-card">
          <strong>${series[0]}</strong>
          <span>${series[1]} imaj · ${series[2]} · ${series[3]}</span>
        </article>
      `
    )
    .join("")

  $("#findings-list").innerHTML = study.findings
    .map((finding) => `<div class="finding">${finding}</div>`)
    .join("")

  renderViewports(study)
}

function renderViewports(study) {
  const ids = ["a", "b", "c", "d"]
  const scanNodes = document.querySelectorAll(".scan")
  const template = scanTemplateFor(study)

  ids.forEach((id, index) => {
    const series = study.series[index % study.series.length]
    const scan = scanNodes[index]
    scan.className = `scan scan-${template} ${index > 0 ? "scan-alt" : ""} ${
      index > 1 ? "scan-small" : ""
    }`
    scan.innerHTML = scanMarkup(template, index)

    $(`#overlay-left-${id}`).textContent =
      `${study.patientName.toUpperCase()}\n${study.patientId} · ${study.date}\n${series[0]}`
    $(`#overlay-right-${id}`).textContent =
      `${study.modality}\n${series[2]}\n${series[3]}`
  })
}

function scanTemplateFor(study) {
  const modality = study.modality
  const bodyPart = normalized(study.bodyPart)

  if (modality === "XA") return "angio"
  if (modality === "MG") return "mammo"
  if (modality === "US" && bodyPart.includes("obstetrik")) return "us-ob"
  if (modality === "US" && bodyPart.includes("tiroid")) return "us-thyroid"
  if (modality === "US") return "us-abdomen"
  if ((modality === "DX" || modality === "CR") && bodyPart.includes("akciger")) {
    return "xray-chest"
  }
  if ((modality === "DX" || modality === "CR") && bodyPart.includes("ayak")) {
    return "xray-ankle"
  }
  if ((modality === "DX" || modality === "CR") && bodyPart.includes("servikal")) {
    return "xray-cervical"
  }
  if (bodyPart.includes("beyin")) return modality === "BT" ? "ct-brain" : "mr-brain"
  if (bodyPart.includes("toraks")) return "ct-chest"
  if (bodyPart.includes("abdomen")) return modality === "BT" ? "ct-abdomen" : "us-abdomen"
  if (bodyPart.includes("sinus")) return "ct-sinus"
  if (bodyPart.includes("lomber")) return "mr-spine"
  if (bodyPart.includes("diz")) return "mr-knee"
  if (bodyPart.includes("omuz")) return "mr-shoulder"

  return "generic"
}

function scanMarkup(template, index) {
  const phase = index % 4

  const markup = {
    "mr-brain": `
      <div class="dicom-object brain">
        <i class="brain-rim"></i><i class="brain-lobe left"></i><i class="brain-lobe right"></i>
        <i class="ventricle left"></i><i class="ventricle right"></i><i class="midline"></i>
      </div>`,
    "ct-brain": `
      <div class="dicom-object brain ct">
        <i class="skull"></i><i class="brain-lobe left"></i><i class="brain-lobe right"></i>
        <i class="ventricle left"></i><i class="ventricle right"></i><i class="midline"></i>
      </div>`,
    "ct-chest": `
      <div class="dicom-object chest">
        <i class="ribcage"></i><i class="lung left"></i><i class="lung right"></i>
        <i class="heart"></i><i class="spine-dot"></i>
      </div>`,
    "xray-chest": `
      <div class="dicom-object xchest">
        <i class="clavicle left"></i><i class="clavicle right"></i>
        <i class="lung left"></i><i class="lung right"></i><i class="heart"></i><i class="diaphragm"></i>
      </div>`,
    "ct-abdomen": `
      <div class="dicom-object abdomen">
        <i class="body-ring"></i><i class="liver"></i><i class="spleen"></i>
        <i class="kidney left"></i><i class="kidney right"></i><i class="spine-dot"></i>
      </div>`,
    "ct-sinus": `
      <div class="dicom-object sinus">
        <i class="face"></i><i class="sinus-cavity left"></i><i class="sinus-cavity right"></i>
        <i class="septum"></i><i class="orbit left"></i><i class="orbit right"></i>
      </div>`,
    "mr-spine": `
      <div class="dicom-object spine">
        <i class="canal"></i><i class="disc d1"></i><i class="disc d2"></i><i class="disc d3"></i>
        <i class="disc d4"></i><i class="vertebra v1"></i><i class="vertebra v2"></i>
      </div>`,
    "mr-knee": `
      <div class="dicom-object knee">
        <i class="femur"></i><i class="tibia"></i><i class="meniscus left"></i>
        <i class="meniscus right"></i><i class="patella"></i>
      </div>`,
    "mr-shoulder": `
      <div class="dicom-object shoulder">
        <i class="humerus"></i><i class="glenoid"></i><i class="acromion"></i><i class="cuff"></i>
      </div>`,
    mammo: `
      <div class="dicom-object mammo">
        <i class="breast ${phase % 2 === 0 ? "right" : "left"}"></i>
        <i class="pectoralis"></i><i class="marker"></i><i class="speck s1"></i><i class="speck s2"></i>
      </div>`,
    "xray-ankle": `
      <div class="dicom-object ankle">
        <i class="tibia"></i><i class="fibula"></i><i class="talus"></i><i class="calcaneus"></i>
      </div>`,
    "xray-cervical": `
      <div class="dicom-object cervical">
        <i class="spine-line"></i><i class="cdisc c1"></i><i class="cdisc c2"></i>
        <i class="cdisc c3"></i><i class="jaw"></i>
      </div>`,
    "us-abdomen": `
      <div class="dicom-object ultrasound">
        <i class="sector"></i><i class="organ liver"></i><i class="shadow"></i><i class="measure"></i>
      </div>`,
    "us-thyroid": `
      <div class="dicom-object ultrasound thyroid">
        <i class="sector"></i><i class="lobe left"></i><i class="lobe right"></i><i class="nodule"></i>
      </div>`,
    "us-ob": `
      <div class="dicom-object ultrasound obstetric">
        <i class="sector"></i><i class="gest-sac"></i><i class="fetal-head"></i><i class="fetal-body"></i>
      </div>`,
    angio: `
      <div class="dicom-object angio">
        <i class="vessel main"></i><i class="vessel branch b1"></i><i class="vessel branch b2"></i>
        <i class="vessel branch b3"></i><i class="stenosis"></i>
      </div>`,
    generic: `
      <div class="dicom-object generic">
        <i class="body-ring"></i><i class="spine-dot"></i>
      </div>`,
  }

  return markup[template] || markup.generic
}

function render() {
  renderTabs()
  renderStudyList()
  renderStudy()
}

$("#study-search").addEventListener("input", (event) => {
  state.query = event.target.value
  renderStudyList()
})

$("#modality-tabs").addEventListener("click", (event) => {
  const button = event.target.closest("button[data-modality]")
  if (!button) return
  state.modality = button.dataset.modality
  render()
})

$("#study-list").addEventListener("click", (event) => {
  const row = event.target.closest("button[data-study-id]")
  if (!row) return
  state.selectedId = row.dataset.studyId
  render()
})

render()
