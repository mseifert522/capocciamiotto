(function () {
  const toggle = document.querySelector(".nav-toggle");
  const links = document.querySelector(".nav-links");
  if (toggle && links) {
    const setOpen = (open) => {
      links.classList.toggle("open", open);
      document.body.classList.toggle("menu-open", open);
      toggle.setAttribute("aria-expanded", open ? "true" : "false");
      toggle.setAttribute("aria-label", open ? "Close menu" : "Open menu");
    };
    toggle.addEventListener("click", () => setOpen(!links.classList.contains("open")));
    links.querySelectorAll("a").forEach((a) => a.addEventListener("click", () => setOpen(false)));
  }

  // Multi person-name fields on contribute form
  const addPersonBtn = document.getElementById("add-person-field");
  const peopleFields = document.getElementById("people-fields");
  if (addPersonBtn && peopleFields) {
    addPersonBtn.addEventListener("click", () => {
      const input = document.createElement("input");
      input.type = "text";
      input.name = "person_name";
      input.placeholder = "Full name of a person in the photo";
      input.maxLength = 120;
      peopleFields.appendChild(input);
    });
  }

  // Dropzone file input
  const drop = document.getElementById("dropzone");
  const fileInput = document.getElementById("photos-input");
  const fileList = document.getElementById("file-list");
  if (drop && fileInput) {
    const showFiles = () => {
      if (!fileList) return;
      const files = Array.from(fileInput.files || []);
      fileList.textContent = files.length
        ? files.map((f) => f.name).join(", ")
        : "No files selected yet.";
    };
    drop.addEventListener("click", () => fileInput.click());
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.style.borderColor = "#6b1f2a";
    });
    drop.addEventListener("dragleave", () => {
      drop.style.borderColor = "";
    });
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.style.borderColor = "";
      if (e.dataTransfer.files?.length) {
        fileInput.files = e.dataTransfer.files;
        showFiles();
      }
    });
    fileInput.addEventListener("change", showFiles);
  }

  const yearUnknown = document.getElementById("year_unknown");
  const yearSelect = document.getElementById("reunion_year");
  if (yearUnknown && yearSelect) {
    yearUnknown.addEventListener("change", () => {
      yearSelect.disabled = yearUnknown.checked;
      if (yearUnknown.checked) yearSelect.value = "";
    });
  }
})();
