# FRETE GG

Aplicativo estático do Grupo Galvão para consulta e simulação de valores de frete ponta a ponta e fracionado.

## Arquitetura

- HTML, CSS e JavaScript puro.
- Firebase Hosting apenas para publicação.
- Sem autenticação, banco de dados ou Firebase Storage.
- Os extratos ficam somente na memória da página e são apagados ao fechar ou recarregar o navegador.
- Consulta de localidades e rotas por serviços públicos do OpenStreetMap/Nominatim e OSRM.

## Melhorias da atualização

- Avisos visuais para veículo não selecionado e endereço inválido.
- Busca de endereços limitada ao Brasil.
- Fila de geocodificação para respeitar o intervalo entre consultas do Nominatim.
- Nova tentativa automática em falhas temporárias de rede.
- Destaque e foco no campo que precisa ser corrigido.
- Histórico mantido somente na memória da página, sem gravação no navegador.

## Publicação

Projeto Firebase exclusivo: `frete-gg`.

```powershell
firebase login
firebase use frete-gg
firebase deploy --only hosting
```

## Estrutura

- `public/`: arquivos publicados no Firebase Hosting.
- `firebase.json`: configuração do Hosting.
- `.firebaserc`: vínculo exclusivo com o projeto Firebase.

Copyright © Grupo Galvão.
