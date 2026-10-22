<?php

namespace App\Database\Migrations;

use CodeIgniter\Database\Migration;

class CreateFilesTable extends Migration
{
    public function up()
    {
        $this->forge->addField([
            'id' => [
                'type'           => 'INT',
                'constraint'     => 11,
                'unsigned'       => true,
                'auto_increment' => true,
            ],
            'original_name' => ['type' => 'VARCHAR', 'constraint' => 255],
            'path'          => ['type' => 'VARCHAR', 'constraint' => 255], // relatif terhadap writable/uploads/
            'mime_type'     => ['type' => 'VARCHAR', 'constraint' => 150, 'null' => true],
            'extension'     => ['type' => 'VARCHAR', 'constraint' => 20, 'null' => true],
            'size'          => ['type' => 'BIGINT', 'unsigned' => true, 'default' => 0],
            'created_at'    => ['type' => 'DATETIME', 'null' => true],
            'updated_at'    => ['type' => 'DATETIME', 'null' => true],
        ]);
        $this->forge->addKey('id', true);
        $this->forge->createTable('files');
    }

    public function down()
    {
        $this->forge->dropTable('files');
    }
}
