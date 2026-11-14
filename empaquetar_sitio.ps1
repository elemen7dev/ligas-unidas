# Arma la carpeta "publicar" (solo lo que va a internet) y el zip para subir a un alojamiento.
# No incluye servir.ps1 (solo para desarrollo). Conserva publicar\.vercel (el vínculo con el proyecto de Vercel).
# Uso:  powershell -File empaquetar_sitio.ps1
$base = Split-Path -Parent $MyInvocation.MyCommand.Path
$origen = Join-Path $base 'sitio'
$destino = Join-Path $base 'publicar'
$zip = Join-Path $base 'ligasunidas-sitio.zip'

$archivos = 'index.html','app.js','panel.js','config.js','styles.css','icono.svg','og.png','robots.txt','_redirects','_headers','.htaccess','vercel.json','api\pagina.js','api\sitemap.js'
if (Test-Path $destino) {
  Get-ChildItem $destino -Force | Where-Object { $_.Name -ne '.vercel' } | Remove-Item -Recurse -Force
} else {
  New-Item -ItemType Directory -Path $destino | Out-Null
}
foreach ($a in $archivos) {
  $ruta = Join-Path $origen $a
  if (-not (Test-Path $ruta)) { throw "Falta $a en sitio\" }
  $dest = Join-Path $destino $a
  New-Item -ItemType Directory -Force -Path (Split-Path -Parent $dest) | Out-Null
  Copy-Item $ruta $dest
}
if (Test-Path $zip) { Remove-Item $zip -Force }
# El zip lleva solo los archivos del sitio (sin .vercel ni .gitignore).
Compress-Archive -Path ($archivos | Where-Object { $_ -notlike 'api*' } | ForEach-Object { Join-Path $destino $_ }) -DestinationPath $zip
"Listo: $destino"
"Zip:   $zip ($([math]::Round((Get-Item $zip).Length / 1KB, 1)) KB)"
Get-ChildItem $destino -Force | Select-Object Name, Length | Format-Table -AutoSize | Out-String
