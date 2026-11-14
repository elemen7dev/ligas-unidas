# Servidor local para probar el sitio (solo desarrollo). Uso: powershell -File servir.ps1 [-Port 8080]
# Sirve los archivos de esta carpeta y devuelve index.html para las rutas sin extensión
# (/ligas, /liga-rural/fixture, /panel), igual que hará el hosting.
param([int]$Port = 8080)
$root = [System.IO.Path]::GetFullPath($PSScriptRoot)
$mime = @{
  '.html' = 'text/html; charset=utf-8'; '.js' = 'text/javascript; charset=utf-8'
  '.css' = 'text/css; charset=utf-8'; '.svg' = 'image/svg+xml'; '.png' = 'image/png'
  '.jpg' = 'image/jpeg'; '.webp' = 'image/webp'; '.json' = 'application/json; charset=utf-8'
}
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$Port/")
$listener.Start()
Write-Host "Sirviendo $root en http://localhost:$Port/"
while ($listener.IsListening) {
  $ctx = $listener.GetContext()
  try {
    $path = [Uri]::UnescapeDataString($ctx.Request.Url.AbsolutePath)
    $ext = [System.IO.Path]::GetExtension($path).ToLower()
    $full = [System.IO.Path]::GetFullPath((Join-Path $root $path.TrimStart('/').Replace('/', '\')))
    $permitido = $full.StartsWith($root) -and $ext -ne '.ps1' -and (Test-Path -LiteralPath $full -PathType Leaf)
    if (-not $permitido) {
      if ($ext) { $ctx.Response.StatusCode = 404; $ctx.Response.Close(); continue }
      $full = Join-Path $root 'index.html'; $ext = '.html'
    }
    $bytes = [System.IO.File]::ReadAllBytes($full)
    $ctx.Response.ContentType = $(if ($mime.ContainsKey($ext)) { $mime[$ext] } else { 'application/octet-stream' })
    $ctx.Response.Headers.Add('Cache-Control', 'no-store')
    $ctx.Response.ContentLength64 = $bytes.Length
    $ctx.Response.OutputStream.Write($bytes, 0, $bytes.Length)
    $ctx.Response.Close()
  } catch { try { $ctx.Response.StatusCode = 500; $ctx.Response.Close() } catch {} }
}
