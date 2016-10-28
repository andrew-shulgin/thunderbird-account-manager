(function () {
    window.addEventListener('load', function () {
        var chooseButton = document.getElementById('choose-csv');
        var prefCsv = document.getElementById('pref_csv');
        var nsIFilePicker = Components.interfaces.nsIFilePicker;
        var fp = Components.classes["@mozilla.org/filepicker;1"].createInstance(nsIFilePicker);
        fp.init(window, 'Select the CSV', nsIFilePicker.modeOpen);
        chooseButton.addEventListener('click', function () {
            if (fp.show() != nsIFilePicker.returnCancel)
                prefCsv.value = fp.file.path;
            prefCsv.updateElements();
        });
    }, false);
})();
