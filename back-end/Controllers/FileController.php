<?php

namespace App\Controllers;

use App\Controllers\BaseController;
use App\Models\FileModel;
use CodeIgniter\API\ResponseTrait;

/**
 * REST API untuk manajemen file.
 *
 * GET    /api/files                 -> daftar file (pagination + pencarian ?q=)
 * GET    /api/files/{id}            -> detail metadata file
 * POST   /api/files                 -> upload file (multipart/form-data, field: file)
 * PUT    /api/files/{id}            -> ubah nama file (JSON: {"original_name": "baru.pdf"})
 * DELETE /api/files/{id}            -> hapus file
 * GET    /api/files/{id}/view       -> tampilkan file di browser (inline)
 * GET    /api/files/{id}/download   -> unduh file
 */
class FileController extends BaseController
{
    use ResponseTrait;

    protected $format    = 'json';
    protected $helpers   = ['security']; // untuk sanitize_filename()
    protected $uploadDir = WRITEPATH . 'uploads/';

    /** Kolom yang aman ditampilkan ke client (path internal disembunyikan). */
    private const PUBLIC_COLUMNS = 'id, original_name, mime_type, extension, size, created_at, updated_at';

    /**
     * GET /api/files
     * Query: ?q=keyword&page=1
     * Memakai ResponseTrait::paginate() (CodeIgniter 4.6+).
     */
    public function index()
    {
        $model = model(FileModel::class)->select(self::PUBLIC_COLUMNS);

        $keyword = trim((string) $this->request->getGet('q'));
        if ($keyword !== '') {
            $model->like('original_name', $keyword);
        }

        return $this->paginate($model->orderBy('id', 'DESC'), 20);
    }

    /**
     * GET /api/files/{id}
     */
    public function show($id = null)
    {
        $file = model(FileModel::class)->select(self::PUBLIC_COLUMNS)->find($id);

        if ($file === null) {
            return $this->failNotFound("File dengan ID {$id} tidak ditemukan.");
        }

        return $this->respond($this->withUrls($file));
    }

    /**
     * POST /api/files
     * Body: multipart/form-data, field "file".
     */
    public function create()
    {
        $rules = [
            'file' => [
                'label' => 'File',
                'rules' => [
                    'uploaded[file]',
                    'max_size[file,5120]', // 5 MB
                    'ext_in[file,jpg,jpeg,png,gif,webp,pdf,doc,docx,xls,xlsx,txt,zip]',
                    'mime_in[file,image/jpg,image/jpeg,image/gif,image/png,image/webp,application/pdf,'
                    . 'application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document,'
                    . 'application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,'
                    . 'text/plain,application/zip,application/x-zip-compressed]',
                ],
            ],
        ];

        // File upload divalidasi langsung dari Request, jadi data = [].
        if (! $this->validateData([], $rules)) {
            return $this->failValidationErrors($this->validator->getErrors());
        }

        $file = $this->request->getFile('file');

        if (! $file->isValid()) {
            return $this->fail($file->getErrorString() . ' (' . $file->getError() . ')', 400);
        }

        if ($file->hasMoved()) {
            return $this->fail('File sudah dipindahkan.', 400);
        }

        // Ambil metadata SEBELUM store(), karena file temp dihapus setelah dipindah.
        $meta = [
            'original_name' => sanitize_filename($file->getClientName()),
            'mime_type'     => $file->getMimeType(),   // terpercaya (bukan dari client)
            'extension'     => $file->guessExtension(), // terpercaya
            'size'          => $file->getSize(),
        ];

        try {
            // store() -> writable/uploads/YYYYMMDD/<nama-acak>, mengembalikan path relatif.
            $meta['path'] = $file->store();
        } catch (\Throwable $e) {
            log_message('error', 'Upload gagal: ' . $e->getMessage());

            return $this->failServerError('Gagal menyimpan file.');
        }

        $model = model(FileModel::class);
        $id    = $model->insert($meta);

        if ($id === false) {
            @unlink($this->uploadDir . $meta['path']); // rollback file fisik

            return $this->failServerError('Gagal menyimpan data file.');
        }

        $saved = $model->select(self::PUBLIC_COLUMNS)->find($id);

        return $this->respondCreated($this->withUrls($saved));
    }

    /**
     * PUT/PATCH /api/files/{id}
     * Body JSON atau form-encoded: original_name
     */
    public function update($id = null)
    {
        $model = model(FileModel::class);

        if ($model->find($id) === null) {
            return $this->failNotFound("File dengan ID {$id} tidak ditemukan.");
        }

        $input = $this->request->getJSON(true) ?? $this->request->getRawInput();

        $rules = [
            'original_name' => 'required|string|max_length[255]',
        ];

        if (! $this->validateData($input, $rules)) {
            return $this->failValidationErrors($this->validator->getErrors());
        }

        $model->update($id, [
            'original_name' => sanitize_filename($input['original_name']),
        ]);

        $updated = $model->select(self::PUBLIC_COLUMNS)->find($id);

        return $this->respond($this->withUrls($updated));
    }

    /**
     * DELETE /api/files/{id}
     */
    public function delete($id = null)
    {
        $model = model(FileModel::class);
        $file  = $model->find($id);

        if ($file === null) {
            return $this->failNotFound("File dengan ID {$id} tidak ditemukan.");
        }

        $fullPath = $this->uploadDir . $file['path'];

        if (is_file($fullPath) && ! unlink($fullPath)) {
            return $this->failServerError('Gagal menghapus file fisik.');
        }

        $model->delete($id);

        return $this->respondDeleted(['id' => (int) $id, 'message' => 'File berhasil dihapus.']);
    }

    /**
     * GET /api/files/{id}/view
     *
     * Menampilkan file langsung di browser (inline). Hanya gambar, PDF, dan
     * teks biasa yang bisa ditampilkan; tipe lain (doc, xls, zip) otomatis
     * diarahkan ke download karena browser tidak bisa merendernya.
     */
    public function view($id = null)
    {
        $file = model(FileModel::class)->find($id);

        if ($file === null) {
            return $this->failNotFound("File dengan ID {$id} tidak ditemukan.");
        }

        $fullPath = $this->uploadDir . $file['path'];

        if (! is_file($fullPath)) {
            return $this->failNotFound('File fisik tidak ditemukan di server.');
        }

        if (! $this->isViewable($file['mime_type'])) {
            return $this->response
                ->download($fullPath, null)
                ->setFileName($file['original_name']);
        }

        $name     = str_replace(['"', "\r", "\n", '\\'], '', $file['original_name']);
        $encoded  = rawurlencode($file['original_name']);
        $charset  = str_starts_with($file['mime_type'], 'text/') ? 'UTF-8' : '';

        return $this->response
            ->setContentType($file['mime_type'], $charset)
            ->setHeader('Content-Disposition', "inline; filename=\"{$name}\"; filename*=UTF-8''{$encoded}")
            ->setHeader('X-Content-Type-Options', 'nosniff') // cegah browser menebak tipe lain
            ->setHeader('Cache-Control', 'private, max-age=3600')
            ->setBody(file_get_contents($fullPath));
    }

    /**
     * GET /api/files/{id}/download
     */
    public function download($id = null)
    {
        $file = model(FileModel::class)->find($id);

        if ($file === null) {
            return $this->failNotFound("File dengan ID {$id} tidak ditemukan.");
        }

        $fullPath = $this->uploadDir . $file['path'];

        if (! is_file($fullPath)) {
            return $this->failNotFound('File fisik tidak ditemukan di server.');
        }

        return $this->response
            ->download($fullPath, null)
            ->setFileName($file['original_name']);
    }

    /** Apakah tipe MIME ini bisa dirender langsung oleh browser? */
    private function isViewable(?string $mime): bool
    {
        if ($mime === null) {
            return false;
        }

        return str_starts_with($mime, 'image/')
            || $mime === 'application/pdf'
            || $mime === 'text/plain';
    }

    /** Tambahkan URL view & download ke data file. */
    private function withUrls(array $file): array
    {
        $file['view_url']     = site_url("api/files/{$file['id']}/view");
        $file['download_url'] = site_url("api/files/{$file['id']}/download");
        $file['is_viewable']  = $this->isViewable($file['mime_type'] ?? null);

        return $file;
    }
}
