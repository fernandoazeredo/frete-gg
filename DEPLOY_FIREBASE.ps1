param(
    [string]$FirebaseProjectId = "frete-gg"
)

$ErrorActionPreference = "Stop"

if (-not (Get-Command firebase -ErrorAction SilentlyContinue)) {
    throw "Firebase CLI não encontrado. Instale com: npm install -g firebase-tools"
}

Write-Host "Validando acesso ao Firebase..."
firebase projects:list | Out-Null

Write-Host "Publicando o FRETE GG no Firebase Hosting..."
firebase deploy --only hosting --project $FirebaseProjectId

Write-Host "Deploy concluido com sucesso."
