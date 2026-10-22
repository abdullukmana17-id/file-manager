import { useEffect, useMemo, useRef, useState } from "react";

/**
 * FileManager — komponen React (Bootstrap 5) untuk REST API manajemen file CodeIgniter 4.
 *
 * Prasyarat: Bootstrap CSS sudah dimuat di aplikasi, misalnya di main.jsx:
 *   import "bootstrap/dist/css/bootstrap.min.css";
 *
 * Endpoint yang dipakai:
 *   GET    {baseUrl}?page=&q=      daftar file (format paginate(): data, meta, links)
 *   POST   {baseUrl}               upload (multipart, field "file")
 *   PUT    {baseUrl}/{id}          ubah nama (JSON: { original_name })
 *   DELETE {baseUrl}/{id}          hapus
 *   GET    {baseUrl}/{id}/view     tampilkan file (inline)
 *   GET    {baseUrl}/{id}/download unduh
 *
 * Props:
 *   baseUrl  : alamat API, default "/api/files"
 *   getToken : (opsional) fungsi yang mengembalikan token untuk header Authorization: Bearer
 *
 * Contoh:
 *   <FileManager baseUrl="http://localhost:8080/api/files" />
 */

// Samakan dengan aturan validasi di FileController::create()
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_EXT = [
  "jpg", "jpeg", "png", "gif", "webp", "pdf",
  "doc", "docx", "xls", "xlsx", "txt", "zip",
];

/* ------------------------------------------------------------------ */
/* Helper                                                              */
/* ------------------------------------------------------------------ */

function parseError(payload, fallback) {
  if (!payload) return fallback;
  const m = payload.messages;
  if (typeof m === "string") return m;
  if (Array.isArray(m)) return m.join(" ");
  if (m && typeof m === "object") return Object.values(m).flat().join(" ");
  return payload.message || fallback;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(value) {
  if (!value) return "-";
  const d = new Date(value.replace(" ", "T"));
  if (Number.isNaN(d.getTime())) return value;
  return d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

function validateFile(file) {
  const ext = file.name.split(".").pop().toLowerCase();
  if (!ALLOWED_EXT.includes(ext)) {
    return `Ekstensi .${ext} tidak diizinkan. Gunakan: ${ALLOWED_EXT.join(", ")}.`;
  }
  if (file.size > MAX_SIZE) {
    return `Ukuran ${formatBytes(file.size)} melebihi batas ${formatBytes(MAX_SIZE)}.`;
  }
  return null;
}

/** Sama dengan FileController::isViewable() di server. */
function isViewable(file) {
  const mime = file?.mime_type || "";
  return mime.startsWith("image/") || mime === "application/pdf" || mime === "text/plain";
}

function createApi(baseUrl, getToken) {
  const authHeaders = () => {
    const token = getToken?.();
    return token ? { Authorization: `Bearer ${token}` } : {};
  };

  async function request(path = "", options = {}) {
    const res = await fetch(`${baseUrl}${path}`, {
      ...options,
      headers: { Accept: "application/json", ...authHeaders(), ...(options.headers || {}) },
    });
    const isJson = (res.headers.get("content-type") || "").includes("json");
    const payload = isJson ? await res.json() : null;
    if (!res.ok) throw new Error(parseError(payload, `Permintaan gagal (${res.status}).`));
    return payload;
  }

  // Ambil isi file sebagai blob (header Authorization ikut terkirim).
  async function fetchBlob(path, failMessage) {
    const res = await fetch(`${baseUrl}${path}`, { headers: authHeaders() });
    if (!res.ok) {
      let payload = null;
      try { payload = await res.json(); } catch { /* bukan JSON */ }
      throw new Error(parseError(payload, `${failMessage} (${res.status}).`));
    }
    return res.blob();
  }

  return {
    list: ({ page, q }) => {
      const params = new URLSearchParams({ page: String(page) });
      if (q) params.set("q", q);
      return request(`?${params.toString()}`);
    },

    rename: (id, original_name) =>
      request(`/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ original_name }),
      }),

    remove: (id) => request(`/${id}`, { method: "DELETE" }),

    // Untuk pratinjau: kembalikan object URL sementara.
    async viewUrl(file) {
      const blob = await fetchBlob(`/${file.id}/view`, "Gagal membuka file");
      return URL.createObjectURL(blob);
    },

    async download(file) {
      const blob = await fetchBlob(`/${file.id}/download`, "Gagal mengunduh");
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = file.original_name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    },

    // XMLHttpRequest dipakai agar progres upload bisa ditampilkan.
    upload(file, onProgress) {
      return new Promise((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open("POST", baseUrl);
        xhr.setRequestHeader("Accept", "application/json");
        Object.entries(authHeaders()).forEach(([k, v]) => xhr.setRequestHeader(k, v));

        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100));
        };
        xhr.onload = () => {
          let payload = null;
          try { payload = JSON.parse(xhr.responseText); } catch { /* bukan JSON */ }
          if (xhr.status >= 200 && xhr.status < 300) resolve(payload);
          else reject(new Error(parseError(payload, `Upload gagal (${xhr.status}).`)));
        };
        xhr.onerror = () => reject(new Error("Koneksi ke server gagal."));

        const form = new FormData();
        form.append("file", file);
        xhr.send(form);
      });
    },
  };
}

/* ------------------------------------------------------------------ */
/* Modal pratinjau                                                     */
/* ------------------------------------------------------------------ */

function PreviewModal({ file, src, loading, error, onClose, onDownload }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    document.body.classList.add("modal-open");
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.classList.remove("modal-open");
    };
  }, [onClose]);

  const isImage = (file.mime_type || "").startsWith("image/");

  return (
    <>
      <div
        className="modal fade show d-block"
        tabIndex="-1"
        role="dialog"
        aria-modal="true"
        aria-label={`Pratinjau ${file.original_name}`}
        onClick={onClose}
      >
        <div
          className="modal-dialog modal-xl modal-dialog-centered modal-dialog-scrollable"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="modal-content">
            <div className="modal-header">
              <h5 className="modal-title text-truncate">{file.original_name}</h5>
              <button type="button" className="btn-close" aria-label="Tutup" onClick={onClose} />
            </div>

            <div className="modal-body p-0 fm-preview-body d-flex align-items-center justify-content-center">
              {loading && (
                <div className="text-center text-body-secondary py-5">
                  <div className="spinner-border spinner-border-sm me-2" role="status" />
                  Memuat…
                </div>
              )}
              {error && <div className="alert alert-danger m-3 w-100">{error}</div>}
              {src && isImage && <img src={src} alt={file.original_name} className="fm-preview-img" />}
              {src && !isImage && (
                <iframe src={src} title={file.original_name} className="fm-preview-frame" />
              )}
            </div>

            <div className="modal-footer">
              <button type="button" className="btn btn-outline-secondary" onClick={() => onDownload(file)}>
                Unduh
              </button>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Tutup
              </button>
            </div>
          </div>
        </div>
      </div>
      <div className="modal-backdrop fade show" />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* Komponen                                                            */
/* ------------------------------------------------------------------ */

export default function FileManager({ baseUrl = "/api/files", getToken }) {
  const api = useMemo(() => createApi(baseUrl.replace(/\/$/, ""), getToken), [baseUrl, getToken]);

  const [files, setFiles] = useState([]);
  const [meta, setMeta] = useState({ page: 1, perPage: 20, total: 0, totalPages: 1 });
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const [uploads, setUploads] = useState([]);
  const [dragging, setDragging] = useState(false);

  const [renamingId, setRenamingId] = useState(null);
  const [renameValue, setRenameValue] = useState("");
  const [confirmId, setConfirmId] = useState(null);
  const [busyId, setBusyId] = useState(null);

  // Pratinjau
  const [preview, setPreview] = useState(null); // { file, src, loading, error }
  const previewSeq = useRef(0);

  const inputRef = useRef(null);
  const uid = useRef(0);
  const requestSeq = useRef(0);

  /* ---------- Ambil data ---------- */

  useEffect(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError("");

    api
      .list({ page, q: query })
      .then((res) => {
        if (seq !== requestSeq.current) return; // abaikan respons usang
        setFiles(res.data ?? []);
        setMeta(res.meta ?? { page, perPage: 20, total: 0, totalPages: 1 });
      })
      .catch((e) => seq === requestSeq.current && setError(e.message))
      .finally(() => seq === requestSeq.current && setLoading(false));
  }, [api, page, query, reloadKey]);

  // Debounce pencarian
  useEffect(() => {
    const t = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 350);
    return () => clearTimeout(t);
  }, [search]);

  // Pesan sukses hilang otomatis
  useEffect(() => {
    if (!notice) return undefined;
    const t = setTimeout(() => setNotice(""), 3000);
    return () => clearTimeout(t);
  }, [notice]);

  // Bersihkan object URL saat komponen dilepas
  useEffect(() => () => {
    if (preview?.src) URL.revokeObjectURL(preview.src);
  }, [preview?.src]);

  const reload = () => setReloadKey((k) => k + 1);

  /* ---------- Upload ---------- */

  const patchUpload = (id, patch) =>
    setUploads((list) => list.map((u) => (u.id === id ? { ...u, ...patch } : u)));
  const dropUpload = (id) => setUploads((list) => list.filter((u) => u.id !== id));

  const handleFiles = async (fileList) => {
    const selected = Array.from(fileList || []);
    let uploadedAny = false;

    for (const file of selected) {
      const id = ++uid.current;
      const problem = validateFile(file);

      if (problem) {
        setUploads((l) => [...l, { id, name: file.name, progress: 0, error: problem }]);
        continue;
      }

      setUploads((l) => [...l, { id, name: file.name, progress: 0, error: null }]);
      try {
        await api.upload(file, (p) => patchUpload(id, { progress: p }));
        patchUpload(id, { progress: 100, done: true });
        uploadedAny = true;
        setTimeout(() => dropUpload(id), 2500);
      } catch (e) {
        patchUpload(id, { error: e.message });
      }
    }

    if (inputRef.current) inputRef.current.value = "";
    if (uploadedAny) {
      setNotice("File berhasil diunggah.");
      setSearch("");
      setQuery("");
      setPage(1);
      reload();
    }
  };

  const onDrop = (e) => {
    e.preventDefault();
    setDragging(false);
    handleFiles(e.dataTransfer.files);
  };

  /* ---------- Ubah nama ---------- */

  const startRename = (file) => {
    setConfirmId(null);
    setRenamingId(file.id);
    setRenameValue(file.original_name);
  };

  const submitRename = async (file) => {
    const name = renameValue.trim();
    if (!name || name === file.original_name) {
      setRenamingId(null);
      return;
    }
    setBusyId(file.id);
    try {
      const updated = await api.rename(file.id, name);
      setFiles((list) => list.map((f) => (f.id === file.id ? { ...f, ...updated } : f)));
      setNotice("Nama file diperbarui.");
      setRenamingId(null);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  /* ---------- Hapus ---------- */

  const removeFile = async (file) => {
    setBusyId(file.id);
    try {
      await api.remove(file.id);
      setConfirmId(null);
      setNotice(`"${file.original_name}" dihapus.`);
      if (files.length === 1 && page > 1) setPage((p) => p - 1);
      else reload();
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  /* ---------- Unduh ---------- */

  const downloadFile = async (file) => {
    setBusyId(file.id);
    try {
      await api.download(file);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusyId(null);
    }
  };

  /* ---------- Lihat (pratinjau) ---------- */

  const openPreview = async (file) => {
    const seq = ++previewSeq.current;
    setPreview({ file, src: null, loading: true, error: "" });
    try {
      const src = await api.viewUrl(file);
      if (seq !== previewSeq.current) {
        URL.revokeObjectURL(src);
        return;
      }
      setPreview({ file, src, loading: false, error: "" });
    } catch (e) {
      if (seq === previewSeq.current) {
        setPreview({ file, src: null, loading: false, error: e.message });
      }
    }
  };

  const closePreview = () => {
    previewSeq.current += 1;
    setPreview(null);
  };

  /* ---------- Tampilan ---------- */

  const totalPages = Math.max(meta.totalPages || 1, 1);

  return (
    <section className="container py-4" style={{ maxWidth: 1000 }}>
      {/* Header */}
      <div className="row g-3 align-items-end mb-3">
        <div className="col-12 col-md">
          <h2 className="h4 fw-bold mb-0">Berkas</h2>
          <p className="text-body-secondary small mb-0">
            {meta.total} file{query ? ` untuk “${query}”` : ""}
          </p>
        </div>
        <div className="col-12 col-md-5 col-lg-4">
          <input
            type="search"
            className="form-control"
            placeholder="Cari nama file"
            aria-label="Cari nama file"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {/* Area upload */}
      <div
        className={`fm-drop text-center p-4${dragging ? " is-over" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragging(true); }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
      >
        <p className="mb-1">
          Tarik file ke sini, atau{" "}
          <button type="button" className="btn btn-link p-0 align-baseline" onClick={() => inputRef.current?.click()}>
            pilih dari perangkat
          </button>
        </p>
        <p className="text-body-secondary small mb-0">
          {ALLOWED_EXT.join(", ")} · maksimal {formatBytes(MAX_SIZE)} per file
        </p>
        <input ref={inputRef} type="file" multiple hidden onChange={(e) => handleFiles(e.target.files)} />
      </div>

      {/* Daftar upload berjalan */}
      {uploads.length > 0 && (
        <ul className="list-group mt-3" aria-live="polite">
          {uploads.map((u) => (
            <li key={u.id} className={`list-group-item${u.error ? " list-group-item-danger" : ""}`}>
              <div className="d-flex align-items-center gap-2 small">
                <span className="flex-grow-1 text-truncate">{u.name}</span>
                <span className={u.done ? "text-success" : u.error ? "text-danger" : "text-body-secondary"}>
                  {u.error ? "Gagal" : u.done ? "Selesai" : `${u.progress}%`}
                </span>
                {u.error && (
                  <button type="button" className="btn-close btn-sm" aria-label="Tutup" onClick={() => dropUpload(u.id)} />
                )}
              </div>
              {u.error ? (
                <p className="small text-danger mt-1 mb-0">{u.error}</p>
              ) : (
                <div className="progress fm-progress mt-2" role="progressbar" aria-valuenow={u.progress} aria-valuemin={0} aria-valuemax={100}>
                  <div className={`progress-bar${u.done ? " bg-success" : ""}`} style={{ width: `${u.progress}%` }} />
                </div>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Notifikasi */}
      {notice && <div className="alert alert-success py-2 mt-3 mb-0" role="status">{notice}</div>}
      {error && (
        <div className="alert alert-danger py-2 mt-3 mb-0 d-flex justify-content-between align-items-center" role="alert">
          <span>{error}</span>
          <button type="button" className="btn btn-sm btn-outline-danger" onClick={() => { setError(""); reload(); }}>
            Coba lagi
          </button>
        </div>
      )}

      {/* Tabel */}
      <div className="card mt-3" aria-busy={loading}>
        <div className="table-responsive">
          <table className="table table-hover align-middle mb-0 fm-table">
            <thead className="table-light">
              <tr>
                <th>Nama</th>
                <th>Tipe</th>
                <th className="text-end">Ukuran</th>
                <th>Diunggah</th>
                <th className="visually-hidden">Aksi</th>
              </tr>
            </thead>
            <tbody>
              {files.map((f) => (
                <tr key={f.id} className={busyId === f.id ? "fm-row-busy" : ""}>
                  <td className="fm-name">
                    {renamingId === f.id ? (
                      <input
                        className="form-control form-control-sm"
                        autoFocus
                        value={renameValue}
                        maxLength={255}
                        aria-label="Nama file baru"
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") submitRename(f);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                      />
                    ) : (
                      <span className="fm-truncate fw-medium" title={f.original_name}>
                        {f.original_name}
                      </span>
                    )}
                  </td>
                  <td>
                    <span className="badge text-bg-secondary">{(f.extension || "-").toUpperCase()}</span>
                  </td>
                  <td className="text-end text-nowrap">{formatBytes(f.size)}</td>
                  <td className="text-nowrap">{formatDate(f.created_at)}</td>
                  <td className="text-end text-nowrap">
                    {renamingId === f.id ? (
                      <div className="btn-group btn-group-sm">
                        <button type="button" className="btn btn-primary" onClick={() => submitRename(f)}>Simpan</button>
                        <button type="button" className="btn btn-outline-secondary" onClick={() => setRenamingId(null)}>Batal</button>
                      </div>
                    ) : confirmId === f.id ? (
                      <>
                        <span className="small text-danger me-2">Hapus file ini?</span>
                        <div className="btn-group btn-group-sm">
                          <button type="button" className="btn btn-danger" onClick={() => removeFile(f)}>Hapus</button>
                          <button type="button" className="btn btn-outline-secondary" onClick={() => setConfirmId(null)}>Batal</button>
                        </div>
                      </>
                    ) : (
                      <div className="btn-group btn-group-sm">
                        {isViewable(f) && (
                          <button type="button" className="btn btn-outline-primary" onClick={() => openPreview(f)}>
                            Lihat
                          </button>
                        )}
                        <button type="button" className="btn btn-outline-secondary" onClick={() => downloadFile(f)}>Unduh</button>
                        <button type="button" className="btn btn-outline-secondary" onClick={() => startRename(f)}>Ubah nama</button>
                        <button type="button" className="btn btn-outline-danger" onClick={() => setConfirmId(f.id)}>Hapus</button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {loading && (
          <div className="text-center text-body-secondary py-4">
            <div className="spinner-border spinner-border-sm me-2" role="status" />
            Memuat…
          </div>
        )}
        {!loading && files.length === 0 && !error && (
          <p className="text-center text-body-secondary py-4 mb-0">
            {query ? "Tidak ada file yang cocok dengan pencarian." : "Belum ada file. Unggah file pertama Anda di atas."}
          </p>
        )}
      </div>

      {/* Pagination */}
      {totalPages > 1 && (
        <nav className="d-flex justify-content-center align-items-center gap-3 mt-3" aria-label="Halaman">
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>
            Sebelumnya
          </button>
          <span className="small text-body-secondary">Halaman {meta.page} dari {totalPages}</span>
          <button type="button" className="btn btn-outline-secondary btn-sm" disabled={page >= totalPages || loading} onClick={() => setPage((p) => p + 1)}>
            Berikutnya
          </button>
        </nav>
      )}

      {/* Modal pratinjau */}
      {preview && (
        <PreviewModal
          file={preview.file}
          src={preview.src}
          loading={preview.loading}
          error={preview.error}
          onClose={closePreview}
          onDownload={downloadFile}
        />
      )}
    </section>
  );
}
