const STORAGE_KEY = "scholarspace-workspace-v1";

const elements = {
  title: document.querySelector("#projectTitle"),
  topic: document.querySelector("#researchQuestion"),
  discipline: document.querySelector("#discipline"),
  paperType: document.querySelector("#paperType"),
  citationStyle: document.querySelector("#citationStyle"),
  targetWords: document.querySelector("#wordCount"),
  writingContent: document.querySelector("#writingContent"),
  wordCountDisplay: document.querySelector("#wordCountDisplay"),
  topicCount: document.querySelector("#topicCount"),
  citationStyleDisplay: document.querySelector("#citationStyleDisplay"),
  sourceCount: document.querySelector("#sourceCount"),
  saveStatus: document.querySelector("#saveStatus"),
  toast: document.querySelector("#toast"),
  sourceDialog: document.querySelector("#sourceDialog"),
  sourceForm: document.querySelector("#sourceForm"),
  keywordClusterList: document.querySelector("#keywordClusterList")
};

const defaultDraft = `Begin with a clear introduction to the research topic and explain why it matters. Establish the context for your study using verified, relevant scholarly sources.\n\nIntroduce your research question: ${elements.topic.value.trim()}\n\nDevelop your argument using evidence from your reading. Compare perspectives, assess the quality of the evidence, and explain how each source relates to your question. Replace this working text with your own analysis and cite sources according to ${elements.citationStyle.value}.\n\nConclude by bringing your main findings together. Explain what the evidence suggests, acknowledge limitations, and identify questions for future research.`;

let state = {
  title: elements.title.value,
  topic: elements.topic.value,
  discipline: elements.discipline.value,
  paperType: elements.paperType.value,
  citationStyle: elements.citationStyle.value,
  targetWords: elements.targetWords.value,
  outline: null,
  draft: defaultDraft,
  sources: [],
  activeTab: "outline",
  hintDismissed: false
};
let toastTimeout;
let saveTimeout;
let openAlexSearch = { query: "", results: [], status: "idle" };
let openAlexController;
let authUser = null;
let libraryView = { query: "", type: "all", sort: "recent" };

function loadState() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return;
    const parsed = JSON.parse(saved);
    if (!parsed || typeof parsed !== "object") return;
    const oldStarterTitle = "The impact of urban green spaces on mental well-being";
    const oldStarterTopic = "How does access to urban green space influence stress and overall mental well-being among adults?";
    const previousTaxTitle = "Advanced international taxation: principles and cross-border challenges";
    const taxTopic = "How do advanced international tax rules address cross-border business activity, tax avoidance, and the allocation of taxing rights?";
    const newStarterTopic = elements.topic.value;
    const wasUntouchedStarter = parsed.title === oldStarterTitle && parsed.topic === oldStarterTopic;
    state = { ...state, ...parsed };
    if (wasUntouchedStarter) {
      state.title = elements.title.value;
      state.topic = newStarterTopic;
      if (state.discipline === "Psychology") state.discipline = elements.discipline.value;
      if (state.draft === defaultDraft.replace(newStarterTopic, oldStarterTopic)) {
        state.draft = defaultDraft;
      }
    }
    if (parsed.title === previousTaxTitle && parsed.topic === taxTopic) {
      state.title = elements.title.value;
    }
    if (!Array.isArray(state.sources)) state.sources = [];
  } catch (error) {
    console.error("Could not load the saved workspace.", error);
    showToast("Saved workspace could not be loaded.");
  }
}

function syncInputs() {
  elements.title.value = state.title;
  elements.topic.value = state.topic;
  elements.discipline.value = state.discipline;
  elements.paperType.value = state.paperType;
  elements.citationStyle.value = state.citationStyle;
  elements.targetWords.value = String(state.targetWords);
  document.querySelector("#breadcrumbTitle").textContent = state.title || "New research";
  document.querySelector("#currentProjectLabel").textContent = state.title || "Untitled research";
  document.querySelector("#pageHeading").textContent = state.title ? "Every great paper starts with a question." : "Every great paper starts with a question.";
  document.querySelector("#dismissHint").closest(".bottom-hint").hidden = state.hintDismissed;
  updateTopicCount();
  updateWordCount();
  updateSourceCount();
  updateCitationLabel();
}

function saveState(showConfirmation = false) {
  state.title = elements.title.value.trim();
  state.topic = elements.topic.value;
  state.discipline = elements.discipline.value;
  state.paperType = elements.paperType.value;
  state.citationStyle = elements.citationStyle.value;
  state.targetWords = elements.targetWords.value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    elements.saveStatus.textContent = "Saved locally";
    document.querySelector("#breadcrumbTitle").textContent = state.title || "New research";
    if (showConfirmation) showToast("Your draft is saved in this browser.");
  } catch (error) {
    console.error("Could not save the workspace.", error);
    elements.saveStatus.textContent = "Save failed";
    showToast("Could not save. Check your browser storage settings.");
  }
}

function scheduleSave() {
  elements.saveStatus.textContent = "Saving…";
  window.clearTimeout(saveTimeout);
  saveTimeout = window.setTimeout(() => saveState(), 350);
}

function showToast(message) {
  elements.toast.textContent = message;
  elements.toast.classList.add("show");
  window.clearTimeout(toastTimeout);
  toastTimeout = window.setTimeout(() => elements.toast.classList.remove("show"), 2700);
}

function updateTopicCount() {
  elements.topicCount.textContent = `${elements.topic.value.length} / 500`;
}

function countWords(text) {
  return (text.match(/\b[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*\b/gu) || []).length;
}

function updateWordCount() {
  const draft = document.querySelector("#draftEditor");
  const text = draft ? draft.value : state.draft;
  elements.wordCountDisplay.textContent = `${countWords(text)} words`;
}

function updateSourceCount() {
  elements.sourceCount.textContent = state.sources.length;
  document.querySelector(".tab-source-count").textContent = state.sources.length;
}

function updateCitationLabel() {
  elements.citationStyleDisplay.textContent = elements.citationStyle.value;
}

const topicStopWords = new Set([
  "about", "among", "does", "from", "have", "how", "into", "that", "their", "there",
  "these", "they", "this", "through", "under", "using", "what", "when", "where",
  "which", "while", "with", "would", "your", "access", "adults", "effect",
  "impact", "influence", "overall", "relationship"
]);

function getTopicTerms(value = elements.topic.value) {
  return [...new Set(value.toLowerCase().match(/[\p{L}\p{N}-]+/gu) || [])]
    .filter(term => term.length > 2 && !topicStopWords.has(term));
}

function getKeywordClusters() {
  const topicTerms = getTopicTerms();
  const topic = topicTerms.slice(0, 3).join(" ");
  const lowerTopic = elements.topic.value.toLowerCase();
  let relatedTerms = ["wellbeing", "health outcomes", "quality of life"];
  const taxationTopic = /tax|taxation|fiscal|revenue/.test(lowerTopic);
  if (taxationTopic) {
    relatedTerms = ["Nigerian tax system", "international taxation", "tax policy and reform", "corporate taxation"];
  } else if (/green space|park|urban|nature|environment/.test(lowerTopic)) {
    relatedTerms = ["mental wellbeing", "stress reduction", "green infrastructure", "environmental equity"];
  } else if (/education|student|school|learning/.test(lowerTopic)) {
    relatedTerms = ["learning outcomes", "student wellbeing", "educational equity", "teaching methods"];
  } else if (/climate|carbon|energy|sustainab/.test(lowerTopic)) {
    relatedTerms = ["climate adaptation", "environmental impact", "sustainability policy", "energy transition"];
  } else if (/business|market|organization|workplace/.test(lowerTopic)) {
    relatedTerms = ["organizational outcomes", "market analysis", "corporate governance", "business strategy"];
  } else if (/public health|patient|health|medical|clinical/.test(lowerTopic)) {
    relatedTerms = ["health outcomes", "patient experience", "health equity", "preventive care"];
  }

  return [
    {
      label: "Core concepts",
      terms: topic
        ? taxationTopic ? [topic, "Nigerian Taxation Review"] : [topic, elements.discipline.value]
        : [elements.discipline.value]
    },
    { label: "Related concepts", terms: relatedTerms.slice(0, 4) },
    { label: "Study methods", terms: ["systematic review", "longitudinal study", "meta-analysis"] }
  ];
}

function renderKeywordClusters() {
  if (!elements.keywordClusterList) return;
  elements.keywordClusterList.innerHTML = getKeywordClusters().map(cluster =>
    `<div class="keyword-cluster"><span>${escapeHtml(cluster.label)}</span>${cluster.terms.map(term =>
      `<button class="keyword-cluster-chip" type="button" data-keyword-query="${escapeAttribute(term)}">${escapeHtml(term)}</button>`
    ).join("")}</div>`
  ).join("");
}

function getTopicMatch(title) {
  const terms = getTopicTerms();
  if (!terms.length) return null;
  const titleTerms = new Set((title.toLowerCase().match(/[\p{L}\p{N}-]+/gu) || []).filter(term => term.length > 2));
  const matches = terms.filter(term => titleTerms.has(term) ||
    [...titleTerms].some(titleTerm => titleTerm.startsWith(term) || term.startsWith(titleTerm)));
  return Math.round(matches.length / terms.length * 100);
}

function getCitationReadiness(work) {
  const fields = [
    Boolean(work.title),
    Boolean(work.authorships?.some(authorship => authorship.author?.display_name)),
    Boolean(work.publication_year),
    Boolean(work.doi),
    Boolean(work.primary_location?.source?.display_name),
    Boolean(work.type)
  ];
  return Math.round(fields.filter(Boolean).length / fields.length * 100);
}

function getScoreClass(score) {
  if (score >= 75) return "score-high";
  if (score >= 40) return "score-medium";
  return "score-low";
}

function safeExternalUrl(value) {
  if (!value) return "";
  try {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) ? url.href : "";
  } catch {
    return "";
  }
}

function formatReference(source) {
  const author = (source.author || "").trim();
  const year = (source.year || "").trim();
  const title = (source.title || "").trim();
  const url = (source.url || "").trim();
  const style = elements.citationStyle.value;

  if (style.startsWith("APA")) {
    return [author ? `${author}.` : "", year ? `(${year}).` : "", title ? `${title}.` : "", url]
      .filter(Boolean).join(" ");
  }
  if (style.startsWith("MLA")) {
    return [author ? `${author}.` : "", title ? `"${title}."` : "", year ? `${year}.` : "", url]
      .filter(Boolean).join(" ");
  }
  if (style.startsWith("Chicago")) {
    return [author ? `${author}.` : "", title ? `"${title}."` : "", year ? `${year}.` : "", url]
      .filter(Boolean).join(" ");
  }
  if (style.startsWith("Harvard")) {
    const authorYear = author && year ? `${author} (${year})` : author || (year ? `(${year})` : "");
    return [authorYear ? `${authorYear}.` : "", title ? `${title}.` : "", url ? `Available at: ${url}.` : ""]
      .filter(Boolean).join(" ");
  }
  return [author, year, title, url].filter(Boolean).join(". ");
}

function makeOutline() {
  const topic = elements.topic.value.trim() || "your chosen research topic";
  const discipline = elements.discipline.value;
  const paperType = elements.paperType.value.toLowerCase();
  const target = Number(elements.targetWords.value).toLocaleString();
  const templates = [
    ["Introduction & context", `Introduce ${topic.toLowerCase()}. Establish its importance in ${discipline.toLowerCase()}, define key terms, and narrow toward your research question.`],
    ["Literature review", `Synthesize relevant peer-reviewed research. Compare methods and findings, identify agreements or tensions, and explain what remains underexplored.`],
    ["Approach & evidence", `Describe the evidence or method appropriate to your ${paperType}. Explain your selection criteria and how the evidence will help address the research question.`],
    ["Analysis & discussion", `Organize your analysis around key themes. Support interpretations with verified evidence, consider alternative explanations, and connect findings back to the question.`],
    ["Conclusion", `Summarize what the evidence indicates, acknowledge limitations, and suggest a focused direction for further research.`]
  ];
  return { target, sections: templates };
}

function renderOutline() {
  if (!state.outline) {
    elements.writingContent.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">⌘</span><strong>Your outline will take shape here.</strong><p>Start with your research question, then build a thoughtful structure for your paper.</p></div>`;
    return;
  }
  const sections = state.outline.sections.map(([title, description], index) =>
    `<article class="outline-section"><h3><span>0${index + 1}</span>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p></article>`
  ).join("");
  elements.writingContent.innerHTML = `<div class="outline-list"><p class="outline-intro">A suggested structure for a ${escapeHtml(state.outline.target)}-word paper. Adapt each section to your evidence and assignment.</p>${sections}</div>`;
}

function renderDraft() {
  elements.writingContent.innerHTML = `<textarea class="draft-editor" id="draftEditor" aria-label="Editable academic draft">${escapeHtml(state.draft)}</textarea>`;
  const editor = document.querySelector("#draftEditor");
  editor.addEventListener("input", () => {
    state.draft = editor.value;
    updateWordCount();
    scheduleSave();
  });
  updateWordCount();
}

function buildAcademicSearchAssist() {
  const topic = (elements.topic.value || "").trim();
  const discipline = elements.discipline.value || "Research";
  const paperType = elements.paperType.value || "research paper";
  const cleanTopic = topic
    .toLowerCase()
    .replace(/^(how does|what is|why|how|when|where|which|who|what)\s+/i, "")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  const baseTerms = (cleanTopic || discipline).split(/\s+/).filter(word => word.length > 2);
  const supportTerms = [
    "mental health",
    "wellbeing",
    "stress",
    "green infrastructure",
    "urban planning",
    "public health",
    "systematic review",
    "intervention"
  ];
  const suggestions = [
    topic || `${discipline} ${paperType}`,
    `${topic || discipline} ${elements.discipline.value}`,
    `${(baseTerms.slice(0, 5).join(" ") || discipline).trim()} ${supportTerms[0]}`,
    `${(baseTerms.slice(0, 5).join(" ") || discipline).trim()} ${supportTerms[2]} ${supportTerms[3]}`
  ].filter(Boolean).map((entry, index, array) => ({
    text: entry.replace(/\s+/g, " ").trim(),
    key: `${index}-${entry}`
  })).filter((item, index, all) => all.findIndex(candidate => candidate.text.toLowerCase() === item.text.toLowerCase()) === index);
  const brief = `Use this search pattern to test ${topic || discipline.toLowerCase()} from ${paperType.toLowerCase()} and ${discipline.toLowerCase()} perspectives. Prioritize peer-reviewed studies, compare methods, and look for stress, wellbeing, and environmental outcomes in the evidence.`;
  return { brief, suggestions };
}

function renderSources() {
  renderKeywordClusters();
  const searchResults = openAlexSearch.results.map(work => {
    const author = (work.authorships || [])
      .map(authorship => authorship.author?.display_name)
      .filter(Boolean)
      .join(", ");
    const year = work.publication_year || "";
    const sourceName = work.primary_location?.source?.display_name || "";
    const doiUrl = safeExternalUrl(work.doi);
    const pdfUrl = safeExternalUrl(work.best_oa_location?.pdf_url) || safeExternalUrl(work.primary_location?.pdf_url);
    const alreadyAdded = state.sources.some(source => source.openAlexId === work.id);
    const details = [author || "Author details unavailable", year, sourceName]
      .filter(Boolean)
      .join(" · ");
    const topicMatch = getTopicMatch(work.title || "");
    const readiness = getCitationReadiness(work);
    const accessStatus = work.open_access?.is_oa
      ? `Open access${work.open_access.oa_status ? ` · ${work.open_access.oa_status}` : ""}`
      : "Access status varies";
    const doiLabel = work.doi ? work.doi.replace(/^https?:\/\/doi\.org\//i, "") : "";
    const links = [
      doiUrl ? `<a class="metadata-link doi-link" href="${escapeAttribute(doiUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(doiLabel || "Open DOI")}</a>` : `<span class="metadata-unavailable">DOI not listed</span>`,
      pdfUrl ? `<a class="metadata-link" href="${escapeAttribute(pdfUrl)}" target="_blank" rel="noopener noreferrer">View PDF</a>` : `<span class="metadata-unavailable">No PDF listed</span>`
    ].join("");
    return `<article class="source-entry search-result"><span class="source-entry-icon" aria-hidden="true">⌕</span><div class="source-entry-copy"><strong>${escapeHtml(work.title || "Untitled work")}</strong><small>${escapeHtml(details)}</small><div class="result-badges">${topicMatch === null ? "" : `<span class="result-badge relevance-badge ${getScoreClass(topicMatch)}" title="Heuristic title overlap with your research topic; not a quality or relevance judgment">${topicMatch}% title match</span>`}<span class="result-badge readiness-badge ${getScoreClass(readiness)}" title="Completeness of title, author, year, DOI, publication venue, and work type. This does not assess source credibility or citation correctness.">${readiness}% citation readiness</span></div><div class="metadata-cards"><div class="metadata-card"><span>IDENTIFIER & ACCESS</span>${links}</div><div class="metadata-card"><span>PUBLICATION</span><strong>${escapeHtml(work.type || "Type not listed")}</strong><small>${escapeHtml(accessStatus)}</small></div></div></div><button class="button button-outline button-small search-result-add" type="button" data-add-openalex="${escapeAttribute(work.id)}" ${alreadyAdded ? "disabled" : ""}>${alreadyAdded ? "Added" : "Add to library"}</button></article>`;
  }).join("");
  const searchMessage = openAlexSearch.status === "loading"
    ? `<p class="search-message" role="status">Searching OpenAlex…</p>`
    : openAlexSearch.status === "error"
      ? `<p class="search-message search-error" role="alert">${escapeHtml(openAlexSearch.error)}</p>`
      : openAlexSearch.status === "results" && !openAlexSearch.results.length
        ? `<p class="search-message" role="status">No works found. Try a broader search.</p>`
        : "";
  const initialQuery = openAlexSearch.query || elements.topic.value.trim();
  const assistant = buildAcademicSearchAssist();
  const suggestionButtons = assistant.suggestions.slice(0, 4).map(item => `<button class="ai-search-chip" type="button" data-ai-query="${escapeAttribute(item.text)}">${escapeHtml(item.text)}</button>`).join("");
  const mobileClusters = getKeywordClusters().map(cluster =>
    `<div class="keyword-cluster"><span>${escapeHtml(cluster.label)}</span>${cluster.terms.slice(0, 3).map(term =>
      `<button class="keyword-cluster-chip" type="button" data-keyword-query="${escapeAttribute(term)}">${escapeHtml(term)}</button>`
    ).join("")}</div>`
  ).join("");
  const searchPanel = `<section class="source-search" aria-labelledby="sourceSearchHeading">
    <div class="ai-search-assistant">
      <div class="assistant-header"><span class="assistant-pill">SEARCH ASSISTANT</span><strong>Academic search guidance</strong></div>
      <p>${escapeHtml(assistant.brief)}</p>
      <small class="assistant-disclosure">Topic-aware suggestions are generated locally; no external AI service is connected.</small>
      <div class="assistant-suggestions">${suggestionButtons}</div>
    </div>
    <div class="mobile-keyword-clusters"><h3>Explore keyword clusters</h3><div class="keyword-cluster-list">${mobileClusters}</div></div>
    <h3 id="sourceSearchHeading">Search scholarly works</h3>
    <p>Find publications in OpenAlex and add verified details to your library, or search Academia.edu and Wikipedia for additional context.</p>
    <form class="source-search-form" id="openAlexSearchForm">
      <label class="visually-hidden" for="openAlexQuery">Search OpenAlex</label>
      <input id="openAlexQuery" type="search" maxlength="300" placeholder="Search by title, topic, or author" value="${escapeAttribute(initialQuery)}" required>
      <button class="button button-primary button-small" type="submit" ${openAlexSearch.status === "loading" ? "disabled" : ""}>Search OpenAlex</button>
      <a class="button button-outline button-small academia-search-link" id="academiaSearchLink" href="https://www.academia.edu/search?q=${encodeURIComponent(initialQuery)}" target="_blank" rel="noopener noreferrer">Search Academia.edu</a>
      <a class="button button-outline button-small wikipedia-search-link" id="wikipediaSearchLink" href="https://en.wikipedia.org/w/index.php?search=${encodeURIComponent(initialQuery)}" target="_blank" rel="noopener noreferrer">Search Wikipedia</a>
    </form>
    ${searchMessage}
    ${searchResults ? `<p class="result-method-note">Title match estimates keyword overlap. Citation readiness checks metadata completeness only—not source quality or citation accuracy.</p><div class="source-list search-results" aria-label="OpenAlex search results">${searchResults}</div>` : ""}
  </section>`;

  if (!state.sources.length) {
    elements.writingContent.innerHTML = `${searchPanel}<div class="empty-state source-empty-state"><span class="empty-icon" aria-hidden="true">⌕</span><strong>Your source library is ready.</strong><p>Add books, articles, and other sources you have verified for your research.</p><button class="button button-outline add-source-button" type="button" data-add-source>Add your first source</button></div>`;
  } else {
    const matches = state.sources
      .map((source, index) => ({ source, index }))
      .filter(({ source }) => {
        const searchable = [
          source.title, source.author, source.year, source.url, source.type,
          ...(Array.isArray(source.tags) ? source.tags : []),
          source.aim, source.method, source.findings, source.relevance
        ].filter(Boolean).join(" ").toLowerCase();
        return searchable.includes(libraryView.query.trim().toLowerCase()) &&
          (libraryView.type === "all" || (source.type || "Other") === libraryView.type);
      });
    matches.sort((left, right) => {
      if (libraryView.sort === "title") return left.source.title.localeCompare(right.source.title);
      if (libraryView.sort === "year") {
        return (Number.parseInt(right.source.year, 10) || 0) - (Number.parseInt(left.source.year, 10) || 0);
      }
      return (right.source.addedAt || 0) - (left.source.addedAt || 0);
    });
    const entries = matches.map(({ source, index }) => {
      const authorYear = [source.author, source.year].filter(Boolean).join(" · ") || "Author and date not added";
      const safeUrl = safeExternalUrl(source.url);
      const url = safeUrl ? `<a href="${escapeAttribute(safeUrl)}" target="_blank" rel="noopener noreferrer">${escapeHtml(safeUrl)}</a>` : "";
      const tags = Array.isArray(source.tags) ? source.tags : [];
      const tagMarkup = tags.length
        ? `<div class="library-tags">${tags.map(tag => `<span class="library-tag">${escapeHtml(tag)}</span>`).join("")}</div>`
        : "";
      return `<article class="source-entry library-entry"><span class="source-entry-icon" aria-hidden="true">▤</span><div class="source-entry-copy"><div class="library-entry-heading"><strong>${escapeHtml(source.title)}</strong><span class="library-type">${escapeHtml(source.type || "Other")}</span></div><small>${escapeHtml(authorYear)}</small>${url}${tagMarkup}<p class="formatted-reference">${escapeHtml(formatReference(source))}</p><button class="text-button source-citation-button" type="button" data-copy-citation="${index}">Copy reference</button></div><button class="delete-source" type="button" data-delete-source="${index}" aria-label="Remove ${escapeAttribute(source.title)}">×</button></article>`;
    }).join("");
    const typeOptions = ["Journal article", "Book", "Report", "Legislation", "Website", "Other"]
      .map(type => `<option value="${type}" ${libraryView.type === type ? "selected" : ""}>${type}</option>`)
      .join("");
    const visibleLabel = `${matches.length} of ${state.sources.length} ${state.sources.length === 1 ? "source" : "sources"}`;
    const noMatches = matches.length ? "" : `<div class="library-no-results"><strong>No sources match these filters.</strong><span>Try another search or source type.</span></div>`;
    elements.writingContent.innerHTML = `${searchPanel}<section class="research-library" aria-labelledby="libraryHeading"><div class="library-header"><div><span class="step-label">YOUR RESEARCH</span><h3 class="library-heading" id="libraryHeading">Source library</h3><p class="library-count">${visibleLabel}</p></div><button class="button button-outline button-small library-add" type="button" data-add-source>+ Add source</button></div><div class="library-toolbar"><label class="visually-hidden" for="libraryQuery">Search your library</label><input id="libraryQuery" type="search" maxlength="200" value="${escapeAttribute(libraryView.query)}" placeholder="Search title, author, notes, or tags"><label class="visually-hidden" for="libraryType">Filter by source type</label><select id="libraryType"><option value="all">All types</option>${typeOptions}</select><label class="visually-hidden" for="librarySort">Sort sources</label><select id="librarySort"><option value="recent" ${libraryView.sort === "recent" ? "selected" : ""}>Recently added</option><option value="title" ${libraryView.sort === "title" ? "selected" : ""}>Title A–Z</option><option value="year" ${libraryView.sort === "year" ? "selected" : ""}>Year, newest</option></select></div><div class="source-list library-source-list">${entries}</div>${noMatches}<button class="text-button copy-references-button" type="button" data-copy-references>Copy all references</button></section>`;
  }
  elements.writingContent.querySelector("[data-add-source]")?.addEventListener("click", openSourceDialog);
  const libraryQuery = document.querySelector("#libraryQuery");
  libraryQuery?.addEventListener("input", () => {
    libraryView.query = libraryQuery.value;
    renderSources();
    const replacement = document.querySelector("#libraryQuery");
    replacement.focus();
    replacement.setSelectionRange(replacement.value.length, replacement.value.length);
  });
  document.querySelector("#libraryType")?.addEventListener("change", event => {
    libraryView.type = event.target.value;
    renderSources();
  });
  document.querySelector("#librarySort")?.addEventListener("change", event => {
    libraryView.sort = event.target.value;
    renderSources();
  });
  document.querySelector("#openAlexSearchForm").addEventListener("submit", searchOpenAlex);
  document.querySelector("#openAlexQuery").addEventListener("input", event => {
    const query = encodeURIComponent(event.target.value.trim());
    document.querySelector("#academiaSearchLink").href = `https://www.academia.edu/search?q=${query}`;
    document.querySelector("#wikipediaSearchLink").href = `https://en.wikipedia.org/w/index.php?search=${query}`;
  });
  elements.writingContent.querySelectorAll("[data-ai-query]").forEach(button => {
    button.addEventListener("click", () => {
      const query = button.dataset.aiQuery;
      const input = document.querySelector("#openAlexQuery");
      if (input) {
        input.value = query;
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.focus();
      }
      showToast("Search suggestion applied.");
    });
  });
  elements.writingContent.querySelectorAll("[data-keyword-query]").forEach(button => {
    button.addEventListener("click", () => runKeywordSearch(button.dataset.keywordQuery));
  });
  elements.writingContent.querySelectorAll("[data-add-openalex]").forEach(button => {
    button.addEventListener("click", () => addOpenAlexWork(button.dataset.addOpenalex));
  });
  elements.writingContent.querySelector("[data-copy-references]")?.addEventListener("click", () => {
    copyText(state.sources.map(formatReference).join("\n\n"), "References copied to clipboard.");
  });
  elements.writingContent.querySelectorAll("[data-copy-citation]").forEach(button => {
    button.addEventListener("click", () => {
      const source = state.sources[Number(button.dataset.copyCitation)];
      if (source) copyText(formatReference(source), "Reference copied to clipboard.");
    });
  });
  elements.writingContent.querySelectorAll("[data-delete-source]").forEach(button => {
    button.addEventListener("click", () => {
      state.sources.splice(Number(button.dataset.deleteSource), 1);
      updateSourceCount();
      if (state.activeTab === "matrix") renderMatrix();
      else renderSources();
      scheduleSave();
    });
  });
}

async function searchOpenAlex(event) {
  event.preventDefault();
  const query = document.querySelector("#openAlexQuery").value.trim();
  if (!query) return;

  openAlexController?.abort();
  openAlexController = new AbortController();
  const controller = openAlexController;
  openAlexSearch = { query, results: [], status: "loading" };
  renderSources();

  try {
    const parameters = new URLSearchParams({
      search: query,
      "per-page": "10",
      select: "id,doi,title,publication_year,authorships,primary_location,best_oa_location,open_access,type"
    });
    const response = await fetch(`https://api.openalex.org/works?${parameters}`, {
      signal: openAlexController.signal
    });
    if (!response.ok) {
      throw new Error(`OpenAlex returned HTTP ${response.status}.`);
    }
    const data = await response.json();
    if (controller.signal.aborted) return;
    openAlexSearch = {
      query,
      results: Array.isArray(data.results) ? data.results : [],
      status: "results"
    };
    renderSources();
  } catch (error) {
    if (error.name === "AbortError" || controller.signal.aborted) return;
    console.error("Could not search OpenAlex.", error);
    openAlexSearch = {
      query,
      results: [],
      status: "error",
      error: "OpenAlex search failed. Check your connection and try again."
    };
    renderSources();
  }
}

function addOpenAlexWork(workId) {
  const work = openAlexSearch.results.find(result => result.id === workId);
  if (!work || state.sources.some(source => source.openAlexId === work.id)) return;

  const authors = (work.authorships || [])
    .map(authorship => authorship.author?.display_name)
    .filter(Boolean)
    .join(", ");
  state.sources.push({
    title: work.title || "Untitled work",
    author: authors,
    year: work.publication_year ? String(work.publication_year) : "",
    url: safeExternalUrl(work.doi) || safeExternalUrl(work.primary_location?.landing_page_url) || safeExternalUrl(work.id),
    type: normalizeSourceType(work.type),
    tags: [],
    addedAt: Date.now(),
    openAlexId: work.id
  });
  updateSourceCount();
  renderSources();
  scheduleSave();
  showToast("Work added to your library.");
}

function runKeywordSearch(query) {
  setActiveTab("sources");
  const input = document.querySelector("#openAlexQuery");
  const form = document.querySelector("#openAlexSearchForm");
  if (!input || !form) return;
  input.value = query;
  form.requestSubmit();
}

function normalizeSourceType(type) {
  const normalized = String(type || "").toLowerCase();
  if (normalized.includes("article") || normalized.includes("journal")) return "Journal article";
  if (normalized.includes("book")) return "Book";
  if (normalized.includes("report") || normalized.includes("dataset")) return "Report";
  if (normalized.includes("legislation") || normalized.includes("law")) return "Legislation";
  if (normalized.includes("web")) return "Website";
  return "Other";
}

const matrixFields = [
  ["aim", "Study aim"],
  ["method", "Method / sample"],
  ["findings", "Key findings"],
  ["limitations", "Limitations"],
  ["relevance", "Relevance to your question"]
];

function getMatrixText() {
  const headings = ["Source", ...matrixFields.map(([, label]) => label)];
  const rows = state.sources.map(source => [
    [source.author, source.year, source.title].filter(Boolean).join(" — "),
    ...matrixFields.map(([field]) => source[field] || "")
  ]);
  return [headings, ...rows].map(row => row.map(value => value.replace(/[\t\r\n]+/g, " ")).join("\t")).join("\n");
}

function renderMatrix() {
  if (!state.sources.length) {
    elements.writingContent.innerHTML = `<div class="empty-state"><span class="empty-icon" aria-hidden="true">▥</span><strong>Your literature review matrix starts with a source.</strong><p>Add an article or book, then compare its aim, method, findings, limitations, and relevance to your question.</p><button class="button button-outline add-source-button" type="button" data-add-source>Add your first source</button></div>`;
    elements.writingContent.querySelector("[data-add-source]").addEventListener("click", openSourceDialog);
    return;
  }

  const rows = state.sources.map((source, index) => {
    const sourceLabel = [source.author, source.year].filter(Boolean).join(" · ");
    const cells = matrixFields.map(([field, label]) =>
      `<td><textarea data-matrix-field="${field}" data-source-index="${index}" aria-label="${escapeAttribute(label)} for ${escapeAttribute(source.title)}" maxlength="1000" placeholder="Add notes...">${escapeHtml(source[field] || "")}</textarea></td>`
    ).join("");
    return `<tr><th scope="row"><strong>${escapeHtml(source.title)}</strong><small>${escapeHtml(sourceLabel || "Author/date not added")}</small></th>${cells}</tr>`;
  }).join("");
  elements.writingContent.innerHTML = `<p class="matrix-intro">Compare your sources across consistent themes. Notes are saved in this browser; verify interpretations against each original publication.</p><div class="matrix-scroll"><table class="review-matrix"><thead><tr><th scope="col">Source</th>${matrixFields.map(([, label]) => `<th scope="col">${escapeHtml(label)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div><button class="button button-outline add-source-button" type="button" data-add-source>+ Add another source</button>`;
  elements.writingContent.querySelector("[data-add-source]").addEventListener("click", openSourceDialog);
  elements.writingContent.querySelectorAll("[data-matrix-field]").forEach(input => {
    input.addEventListener("input", () => {
      const source = state.sources[Number(input.dataset.sourceIndex)];
      if (!source) return;
      source[input.dataset.matrixField] = input.value;
      scheduleSave();
    });
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function escapeAttribute(value) {
  return escapeHtml(value).replace(/`/g, "&#96;");
}

function setActiveTab(tab) {
  state.activeTab = tab;
  for (const name of ["outline", "draft", "sources", "matrix"]) {
    const button = document.querySelector(`#${name}Tab`);
    const active = name === tab;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", String(active));
  }
  if (tab === "outline") renderOutline();
  if (tab === "draft") renderDraft();
  if (tab === "sources") renderSources();
  if (tab === "matrix") renderMatrix();
  scheduleSave();
}

function openSourceDialog() {
  elements.sourceForm.reset();
  elements.sourceDialog.showModal();
  document.querySelector("#sourceTitle").focus();
}

function addSource(event) {
  event.preventDefault();
  const url = document.querySelector("#sourceUrl").value.trim();
  if (url) {
    try {
      const parsedUrl = new URL(url);
      if (!["http:", "https:"].includes(parsedUrl.protocol)) throw new Error("Unsupported link protocol");
    } catch {
      showToast("Enter a valid web address beginning with https://.");
      return;
    }
  }
  state.sources.push({
    title: document.querySelector("#sourceTitle").value.trim(),
    author: document.querySelector("#sourceAuthor").value.trim(),
    year: document.querySelector("#sourceYear").value.trim(),
    url,
    type: document.querySelector("#sourceType").value,
    tags: document.querySelector("#sourceTags").value.split(",").map(tag => tag.trim()).filter(Boolean),
    addedAt: Date.now(),
    aim: document.querySelector("#sourceAim").value.trim(),
    method: document.querySelector("#sourceMethod").value.trim(),
    findings: document.querySelector("#sourceFindings").value.trim(),
    limitations: document.querySelector("#sourceLimitations").value.trim(),
    relevance: document.querySelector("#sourceRelevance").value.trim()
  });
  updateSourceCount();
  elements.sourceDialog.close();
  if (state.activeTab === "matrix") renderMatrix();
  else renderSources();
  scheduleSave();
  showToast("Source added to your library.");
}

function exportDraft() {
  const sections = [
    state.title || "Untitled research",
    `Research question: ${elements.topic.value.trim() || "Not specified"}`,
    `Field: ${elements.discipline.value} | Paper type: ${elements.paperType.value} | Citation style: ${elements.citationStyle.value}`,
    ""
  ];
  if (state.outline?.sections) {
    sections.push("RESEARCH OUTLINE", "");
    state.outline.sections.forEach(([heading, description]) => sections.push(heading, description, ""));
  }
  sections.push("WORKING DRAFT", "", state.draft || "No draft text yet.", "", `REFERENCES (${elements.citationStyle.value})`, "");
  if (state.sources.length) {
    state.sources.forEach(source => sections.push(formatReference(source)));
  } else {
    sections.push("No sources added. Verify and cite your sources before submission.");
  }
  if (state.sources.length) {
    sections.push("", "LITERATURE REVIEW MATRIX", "", getMatrixText());
  }
  const blob = new Blob([sections.join("\n")], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(state.title || "research-draft").replace(/[<>:"/\\|?*]+/g, "-").trim() || "research-draft"}.txt`;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  showToast("Research workspace exported as a text file.");
}

async function copyCurrentText() {
  const text = state.activeTab === "draft"
    ? (document.querySelector("#draftEditor")?.value || "")
    : state.activeTab === "outline" && state.outline
      ? state.outline.sections.map(([heading, description]) => `${heading}\n${description}`).join("\n\n")
      : state.activeTab === "sources"
        ? state.sources.map(source => [source.author, source.year, source.title, source.url].filter(Boolean).join(". ")).join("\n")
        : state.activeTab === "matrix"
          ? getMatrixText()
        : "";
  if (!text) {
    showToast("There is no text to copy yet.");
    return;
  }
  copyText(text, "Copied to clipboard.");
}

async function copyText(text, confirmation) {
  if (!text) {
    showToast("There is no text to copy yet.");
    return;
  }
  try {
    await navigator.clipboard.writeText(text);
    showToast(confirmation);
  } catch (error) {
    console.error("Could not copy text to the clipboard.", error);
    showToast("Clipboard access is unavailable in this browser.");
  }
}

function updateAuthControls(user) {
  authUser = user;
  const signInButton = document.querySelector("#openLogin");
  const profileButton = document.querySelector("#profileLogin");
  const profileName = profileButton.querySelector(".profile-copy strong");
  const profileStatus = profileButton.querySelector(".profile-copy small");
  signInButton.textContent = user ? "Sign out" : "Sign in";
  profileButton.setAttribute("aria-label", user ? "Sign out" : "Sign in");
  profileName.textContent = user ? "Signed-in account" : "Guest";
  profileStatus.textContent = user ? user.email : "Not signed in";
  profileButton.querySelector(".avatar").textContent = user ? user.email[0].toUpperCase() : "G";
}

function setAuthMode(isRegistration) {
  const confirmLabel = document.querySelector("#confirmPasswordLabel");
  const confirmInput = document.querySelector("#confirmPassword");
  const passwordInput = document.querySelector("#loginPassword");
  const toggleButton = document.querySelector("#toggleAuthMode");
  document.querySelector("#loginHeading").textContent = isRegistration ? "Create an account" : "Sign in";
  document.querySelector("#loginDialog .step-label").textContent = isRegistration ? "JOIN SCHOLARSPACE" : "WELCOME BACK";
  document.querySelector("#loginDialog .dialog-description").textContent = isRegistration
    ? "Create an account. Research projects remain stored in this browser."
    : "Sign in to verify your account. Research projects remain stored in this browser.";
  document.querySelector("#submitAuth").textContent = isRegistration ? "Create account" : "Sign in";
  toggleButton.textContent = isRegistration ? "Already have an account? Sign in" : "Create an account";
  passwordInput.autocomplete = isRegistration ? "new-password" : "current-password";
  passwordInput.minLength = isRegistration ? 12 : 1;
  passwordInput.placeholder = isRegistration ? "At least 12 characters" : "Enter your password";
  confirmLabel.hidden = !isRegistration;
  confirmInput.hidden = !isRegistration;
  confirmInput.required = isRegistration;
  document.querySelector("#authNotice").textContent =
    "Accounts are stored in SQLite. Passwords are hashed on the server; research projects still stay local to this browser.";
  const feedback = document.querySelector("#authFeedback");
  feedback.hidden = true;
  feedback.textContent = "";
  document.querySelector("#loginForm").dataset.mode = isRegistration ? "register" : "login";
}

function showAuthFeedback(message) {
  const feedback = document.querySelector("#authFeedback");
  feedback.textContent = message;
  feedback.hidden = false;
}

async function parseAuthResponse(response) {
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 405 || !contentType.includes("application/json")) {
    throw new Error("The current web server does not support authentication requests. Stop Live Server or other static preview, run `node server.js` in the project folder, and open http://127.0.0.1:3000.");
  }
  try {
    return await response.json();
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new Error(`Authentication server returned an invalid response (HTTP ${response.status}). Start it with node server.js.`);
    }
    throw error;
  }
}

async function restoreAuthSession() {
  try {
    const response = await fetch("/api/auth/me", { credentials: "same-origin", cache: "no-store" });
    if (response.status === 401) {
      updateAuthControls(null);
      return;
    }
    if (!response.ok) throw new Error(`Authentication service returned HTTP ${response.status}.`);
    const data = await parseAuthResponse(response);
    if (!data.user || typeof data.user.email !== "string") {
      throw new Error("Authentication server returned an invalid session.");
    }
    updateAuthControls(data.user);
  } catch (error) {
    console.error("Could not check the sign-in session.", error);
    updateAuthControls(null);
  }
}

async function signOut() {
  try {
    const response = await fetch("/api/auth/logout", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: "{}"
    });
    const data = await parseAuthResponse(response);
    if (!response.ok) throw new Error(data.error || `Sign-out failed with HTTP ${response.status}.`);
    updateAuthControls(null);
    showToast("You are signed out.");
  } catch (error) {
    console.error("Could not sign out.", error);
    showToast("Could not connect to the authentication server. Try again.");
  }
}

function initialize() {
  loadState();
  syncInputs();
  renderKeywordClusters();
  setActiveTab(state.activeTab || "outline");

  elements.title.addEventListener("input", () => {
    document.querySelector("#breadcrumbTitle").textContent = elements.title.value.trim() || "New research";
    document.querySelector("#currentProjectLabel").textContent = elements.title.value.trim() || "Untitled research";
    scheduleSave();
  });
  elements.topic.addEventListener("input", () => {
    updateTopicCount();
    renderKeywordClusters();
    if (state.activeTab === "sources") renderSources();
    scheduleSave();
  });
  for (const control of [elements.discipline, elements.paperType, elements.citationStyle, elements.targetWords]) {
    control.addEventListener("change", () => {
      updateCitationLabel();
      if (control === elements.discipline) {
        renderKeywordClusters();
        if (state.activeTab === "sources") renderSources();
      }
      if (control === elements.citationStyle && state.activeTab === "sources") renderSources();
      scheduleSave();
    });
  }
  elements.keywordClusterList.addEventListener("click", event => {
    const button = event.target.closest("[data-keyword-query]");
    if (button) runKeywordSearch(button.dataset.keywordQuery);
  });

  document.querySelector("#generateButton").addEventListener("click", () => {
    state.outline = makeOutline();
    setActiveTab("outline");
    showToast("Your outline is ready to refine.");
  });
  document.querySelector("#outlineTab").addEventListener("click", () => setActiveTab("outline"));
  document.querySelector("#draftTab").addEventListener("click", () => setActiveTab("draft"));
  document.querySelector("#sourcesTab").addEventListener("click", () => setActiveTab("sources"));
  document.querySelector("#matrixTab").addEventListener("click", () => setActiveTab("matrix"));
  document.querySelector("#saveButton").addEventListener("click", () => saveState(true));
  document.querySelector("#exportButton").addEventListener("click", exportDraft);
  document.querySelector("#copyButton").addEventListener("click", copyCurrentText);
  document.querySelector("#newProjectButton").addEventListener("click", () => {
    if ((state.title || state.draft || state.sources.length) &&
        !window.confirm("Start a new project? This replaces the current workspace. Export it first if you want to keep a copy.")) {
      return;
    }
    elements.title.value = "";
    elements.topic.value = "";
    state.title = "";
    state.topic = "";
    state.outline = null;
    state.draft = "";
    state.sources = [];
    state.activeTab = "outline";
    syncInputs();
    setActiveTab("outline");
    scheduleSave();
    showToast("Started a fresh research project.");
  });
  document.querySelector("#clearDraftButton").addEventListener("click", () => {
    if (state.activeTab === "draft") {
      state.draft = "";
      renderDraft();
      scheduleSave();
      showToast("Draft cleared.");
    } else {
      showToast("Open the Draft tab to clear your writing.");
    }
  });
  document.querySelector("#dismissHint").addEventListener("click", () => {
    state.hintDismissed = true;
    document.querySelector("#dismissHint").closest(".bottom-hint").hidden = true;
    scheduleSave();
  });
  document.querySelector("#closeDialog").addEventListener("click", () => elements.sourceDialog.close());
  document.querySelector("#cancelSource").addEventListener("click", () => elements.sourceDialog.close());
  elements.sourceForm.addEventListener("submit", addSource);

  const loginDialog = document.querySelector("#loginDialog");
  const loginForm = document.querySelector("#loginForm");
  const openLogin = () => {
    if (authUser) {
      signOut();
      return;
    }
    loginForm.reset();
    setAuthMode(false);
    loginDialog.showModal();
    document.querySelector("#loginEmail").focus();
  };
  document.querySelector("#openLogin").addEventListener("click", openLogin);
  document.querySelector("#profileLogin").addEventListener("click", openLogin);
  const closeLogin = () => {
    loginForm.reset();
    loginDialog.close();
  };
  document.querySelector("#closeLogin").addEventListener("click", closeLogin);
  document.querySelector("#cancelLogin").addEventListener("click", closeLogin);
  document.querySelector("#toggleAuthMode").addEventListener("click", () => {
    const isRegistration = loginForm.dataset.mode !== "register";
    loginForm.reset();
    setAuthMode(isRegistration);
  });
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const isRegistration = loginForm.dataset.mode === "register";
    const password = document.querySelector("#loginPassword").value;
    if (isRegistration && password !== document.querySelector("#confirmPassword").value) {
      showAuthFeedback("The passwords do not match.");
      return;
    }

    const submitButton = document.querySelector("#submitAuth");
    submitButton.disabled = true;
    document.querySelector("#authFeedback").hidden = true;
    try {
      const response = await fetch(isRegistration ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email: document.querySelector("#loginEmail").value,
          password
        })
      });
      const data = await parseAuthResponse(response);
      if (!response.ok) throw new Error(data.error || `Authentication failed with HTTP ${response.status}.`);
      if (!data.user || typeof data.user.email !== "string") {
        throw new Error("Authentication server returned an invalid account.");
      }
      updateAuthControls(data.user);
      loginForm.reset();
      loginDialog.close();
      showToast(isRegistration ? "Account created and signed in." : "You are signed in.");
    } catch (error) {
      console.error("Authentication request failed.", error);
      showAuthFeedback(error instanceof TypeError
        ? "Could not connect to the authentication server. Start it with npm start and try again."
        : error.message);
    } finally {
      submitButton.disabled = false;
    }
  });
  updateAuthControls(null);
  restoreAuthSession();

  document.querySelectorAll(".nav-item").forEach(button => {
    button.addEventListener("click", () => {
      document.querySelectorAll(".nav-item").forEach(item => item.classList.toggle("active", item === button));
      const view = button.dataset.view;
      if (view === "draft" || view === "sources" || view === "matrix") setActiveTab(view);
      if (view === "workspace") setActiveTab("outline");
      if (view !== "workspace") document.querySelector("#writingPanel").scrollIntoView({ behavior: "smooth", block: "center" });
    });
  });
}

initialize();
