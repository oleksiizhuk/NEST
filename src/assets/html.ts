export const html =
  '<!DOCTYPE html>\n' +
  '<html>\n' +
  '<head>\n' +
  '    <meta charset="utf-8"/>\n' +
  '    <meta http-equiv="X-UA-Compatible" content="IE=edge"/>\n' +
  '    <meta http-equiv="Content-Type" content="text/html charset=UTF-8"/>\n' +
  '    <meta name="viewport" content="width=device-width, initial-scale=1"/>\n' +
  '    <title>Registration</title>\n' +
  '    <link rel="preconnect" href="https://fonts.googleapis.com">\n' +
  '    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>\n' +
  '    <link href="https://fonts.googleapis.com/css2?family=Open+Sans&display=swap" rel="stylesheet">\n' +
  '<body>\n' +
  '<h1>{{title}}</h1>\n' +
  '<button onclick="openPizzaHutApp()" class="button">\n' +
  '    Button\n' +
  '</button>\n' +
  '<p class="body1 smallMarginBottom">\n' +
  '    If the button above doesn’t work, paste this link into your web browser:\n' +
  '</p>\n' +
  '<a class="buttonOutline" href="{{deepLinkUrl}}">\n' +
  '    {{deepLinkUrl}}\n' +
  '</a>\n' +
  '<script>\n' +
  '  function openPizzaHutApp() {\n' +
  "    window.location.href = 'pizzahut://';\n" +
  '  }\n' +
  '</script>\n' +
  '</body>\n' +
  '</html>\n';
