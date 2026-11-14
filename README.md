# Kaizan World

Dunia blok 3D multiplayer. Isi folder ini:

- `server.js` + `public/index.html` : website dan server multiplayer (tanpa library tambahan)
- `android/` : proyek aplikasi Android (membuka websitemu layar penuh)
- `.github/workflows/build-apk.yml` : membuat file APK otomatis di GitHub
- `render.yaml` : pengaturan hosting gratis di Render

APK hanyalah "bungkus" untuk websitenya. Karena itu website harus online dulu (Langkah 1), baru APK dibuat (Langkah 2).

## Langkah 1. Online-kan websitenya (gratis)

1. Buat akun di github.com, buat repositori baru, lalu unggah seluruh isi folder ini (termasuk folder `.github`).
2. Buat akun di render.com, pilih New > Blueprint, hubungkan repositori tadi. Render membaca `render.yaml` dan menjalankan server.
3. Tunggu sampai selesai. Kamu mendapat alamat seperti `https://kaizanworld-xxxx.onrender.com`. Buka alamat itu di HP: gamenya langsung bisa dimainkan bareng teman.

Catatan paket gratis Render: server tidur kalau lama tidak dipakai (buka pertama bisa lambat sekitar 1 menit), dan balok yang dibangun bisa hilang saat server dimulai ulang karena disknya tidak permanen.

Coba di komputer sendiri: `node server.js` lalu buka http://localhost:3000 (perlu Node 18 atau lebih baru).

## Langkah 2. Buat APK

Cara termudah (tanpa menginstal apa pun):
1. Di GitHub, buka repositorimu > tab Actions > "Build APK" > Run workflow.
2. Isi alamat websitemu dari Langkah 1, lalu jalankan.
3. Setelah selesai (sekitar 3 menit), buka hasil jalannya dan unduh artifact `KaizanWorld-APK`. Di dalam zip itu ada `app-debug.apk`.

Cara lain: buka folder `android` di Android Studio, ganti nilai `SITE_URL` di `app/build.gradle`, lalu Build > Build APK.

## Langkah 3. Pasang di HP

Kirim `app-debug.apk` ke HP, buka file itu, dan izinkan "Instal dari sumber tidak dikenal" bila diminta.

## Keamanan dan batasan

- Siapa saja yang membuka website bisa membangun dan menghapus balok. Tidak ada akun, jadi bisa dijahili. Beri tahu saya kalau mau ditambah login atau pembatasan.
- Chat belum difilter. Kalau dipakai anak-anak atau dibuka untuk umum, tambahkan moderasi dulu.
- Koin dan item tersimpan di browser/aplikasi masing-masing pemain, bukan di server.
- APK ini versi debug (cukup untuk dipasang sendiri). Untuk Google Play perlu versi rilis yang ditandatangani.
