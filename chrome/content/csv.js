function csv2array(strData, strDelimiter) {
    strDelimiter = strDelimiter || ',';
    if (strData === '')
        return null;
    if (strData[0] === strDelimiter)
        strData = strDelimiter + strData;

    var objPattern = new RegExp((
        '(\\' + strDelimiter + '|^)' +   // Delimiters.
        '(?:"([^"]*(?:""[^"]*)*)"|' +    // Quoted fields.
        '([^"\\' + strDelimiter + ']*))' // Standard fields.
    ), 'gi');

    var arrData = [];
    var arrMatches = [];
    while (arrMatches = objPattern.exec(strData)) {
        var strMatchedValue;
        if (arrMatches[2]) {
            strMatchedValue = arrMatches[2].replace(new RegExp('""', 'g'), '"');
        } else {
            strMatchedValue = arrMatches[3];
        }
        arrData.push(strMatchedValue);
    }
    return arrData;
}
