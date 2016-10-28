var AccountManager = {
    prefs: null,
    nsIMsgAccountManager: null,
    nsIFile: null,
    logger: null,
    interval: 0,
    csvColumns: [
        'name',
        'dept',
        'inUsername',
        'inPassword',
        'fullName',
        'inType',
        'inHost',
        'inPort',
        'inSecurity',
        'outUsername',
        'outPassword',
        'outHost',
        'outPort',
        'outSecurity'
    ],

    startup: function () {
        Components.utils.import('resource://gre/modules/osfile.jsm');
        Components.utils.import('resource://gre/modules/NetUtil.jsm');
        Components.utils.import('resource://gre/modules/Log.jsm');
        Components.utils.import('resource:///modules/mailServices.js');

        this.prefs = Components.classes['@mozilla.org/preferences-service;1']
            .getService(Components.interfaces.nsIPrefService)
            .getBranch('extensions.account-manager.');
        this.prefs.addObserver('', this, false);

        this.nsIMsgAccountManager = Components.classes['@mozilla.org/messenger/account-manager;1']
            .getService(Components.interfaces.nsIMsgAccountManager);

        this.logger = Log.repository.getLogger(this.constructor.name);
        this.logger.addAppender(new Log.ConsoleAppender(new Log.BasicFormatter()));
        this.logger.level = Log.Level.Debug;

        if (this.prefs.getCharPref('encoding').length === 0) {
            var sysCodePage;
            try {
                var wrk = Components.classes['@mozilla.org/windows-registry-key;1']
                    .createInstance(Components.interfaces.nsIWindowsRegKey);
                wrk.open(wrk.ROOT_KEY_LOCAL_MACHINE, 'SYSTEM\\CurrentControlSet', wrk.ACCESS_READ);
                var subkey = wrk.openChild('Control\\Nls\\CodePage', wrk.ACCESS_READ);
                var cp = subkey.readStringValue('ACP');
                if (cp === '866')
                    cp = 'ibm866';
                else if (cp.match(/^[0-9]{3,4}$/))
                    cp = 'windows-' + cp;
                sysCodePage = cp;
                subkey.close();
                wrk.close();
            } catch (e) {
                sysCodePage = 'utf-8';
            }
            this.prefs.setCharPref('encoding', sysCodePage);
        }

        this.run();
        var self = this;
        this.interval = window.setInterval(function () {self.run.apply(self)}, this.prefs.getIntPref('interval') * 1000);
    },

    shutdown: function () {
        clearInterval(this.interval);
        this.prefs.removeObserver('', this);
    },

    observe: function (subject, topic, data) {
        if (topic != 'nsPref:changed')
            return;

        switch (data) {
            case 'interval':
                window.clearInterval(this.interval);
                var self = this;
                this.interval = window.setInterval(function () {self.run.apply(self)}, this.prefs.getIntPref('interval') * 1000);
                break;
            default:
                this.run();
                break;
        }
    },

    getFileContent: function (path, callback) {
        var accounts = [];
        var self = this;
        var decoder = new TextDecoder(this.prefs.getCharPref('encoding'));
        var promise = OS.File.read(path);
        promise
            .then(
                function onSuccess(array) {
                    return decoder.decode(array);
                })
            .then(function (data) {
                    var lines = data.split('\n');
                    var i = 0;
                    if (self.prefs.getBoolPref('header')) // Ignore header
                        i = 1;
                    lineLoop:
                        for (i; i < lines.length; i++) {
                            var line = lines[i].replace(/\n|\r/g, '');
                            if (line.length) {
                                var columns = csv2array(line);
                                var account = {};
                                if (columns.length != self.csvColumns.length)
                                    continue;
                                var dept = self.prefs.getCharPref('dept');
                                for (var j = 0; j < columns.length; j++) {
                                    if (self.csvColumns[j] === 'dept') {
                                        if (dept !== 'all' && columns[j] !== dept)
                                            continue lineLoop;
                                    }
                                    if (self.csvColumns[j] === 'inSecurity' || self.csvColumns[j] === 'outSecurity')
                                        columns[j] = columns[j].toLowerCase();
                                    account[self.csvColumns[j]] = columns[j];
                                }
                                accounts.push(account);
                            }
                        }
                    callback(accounts);
                }, function () { callback(accounts); }
            );
    },

    // https://dxr.mozilla.org/comm-central/source/obj-x86_64-pc-linux-gnu/dist/include/MailNewsTypes2.h?q=nsMsgSocketType&redirect_type=direct#112
    getSocketType: function (name) {
        var socketType = 1;
        if (name === 'plain' || name === 'none')
            socketType = 0;
        else if (name === 'starttls')
            socketType = 2;
        else if (name === 'ssl' || name === 'tls' || name === 'ssl/tls')
            socketType = 3;
        return socketType;
    },

    walkAccounts: function (newAccounts) {
        var nsIMsgAccounts = this.nsIMsgAccountManager.accounts;
        var accounts = [];
        var existingAccounts = [];
        var remainingAccounts = [];
        var toBeCreated = [];
        var toBeRemoved = [];
        var i, smtpServer, account;
        for (i = 0; i < nsIMsgAccounts.length; i++) {
            account = nsIMsgAccounts.queryElementAt(i, Components.interfaces.nsIMsgAccount);
            if (account.defaultIdentity != null) {
                smtpServer = MailServices.smtp.getServerByKey(account.defaultIdentity.smtpServerKey);
                existingAccounts.push([
                    account.defaultIdentity.identityName,
                    account.incomingServer.username,
                    // account.incomingServer.password,
                    account.defaultIdentity.fullName,
                    account.incomingServer.type,
                    account.incomingServer.hostName,
                    account.incomingServer.port,
                    account.incomingServer.socketType,
                    account.incomingServer.authMethod, // 3
                    smtpServer.description,
                    smtpServer.hostname,
                    smtpServer.port,
                    smtpServer.username,
                    // smtpServer.password,
                    smtpServer.authMethod, // 3
                    smtpServer.socketType
                ].join(','));
                accounts.push(account);
            } else {
                this.removeAccount(account);
            }
        }

        for (i = 0; i < newAccounts.length; i++) {
            account = newAccounts[i];
            var props = [
                account['name'],
                account['inUsername'],
                // account['inPassword'],
                account['fullName'],
                account['inType'],
                account['inHost'],
                account['inPort'],
                this.getSocketType(account['inSecurity']),
                3,
                account['name'],
                account['outHost'],
                account['outPort'],
                account['outUsername'],
                // account['outPassword'],
                3,
                this.getSocketType(account['outSecurity'])
            ].join(',');
            remainingAccounts.push(props);
            if (existingAccounts.indexOf(props) === -1)
                toBeCreated.push(account);
        }

        for (i = 0; i < accounts.length; i++) {
            account = accounts[i];
            smtpServer = MailServices.smtp.getServerByKey(account.defaultIdentity.smtpServerKey);
            if (!this.prefs.getBoolPref('no-remove') && remainingAccounts.indexOf([
                    account.defaultIdentity.identityName,
                    account.incomingServer.username,
                    // account.incomingServer.password,
                    account.defaultIdentity.fullName,
                    account.incomingServer.type,
                    account.incomingServer.hostName,
                    account.incomingServer.port,
                    account.incomingServer.socketType,
                    account.incomingServer.authMethod, // 3
                    smtpServer.description,
                    smtpServer.hostname,
                    smtpServer.port,
                    smtpServer.username,
                    // smtpServer.password,
                    smtpServer.authMethod, // 3
                    smtpServer.socketType
                ].join(',')) === -1)
                toBeRemoved.push(account);
        }
        while (toBeRemoved.length)
            this.removeAccount(toBeRemoved.shift());
        while (toBeCreated.length)
            this.createAccount(toBeCreated.shift());
    },

    createAccount: function (newAccount) {
        var account = this.nsIMsgAccountManager.createAccount();
        var identity = this.nsIMsgAccountManager.createIdentity();
        var inServer = this.nsIMsgAccountManager.createIncomingServer(
            newAccount['inUsername'],
            newAccount['inHost'],
            newAccount['inType']
        );
        var outServer = MailServices.smtp.createServer();

        inServer.prettyName = newAccount['name'];
        inServer.port = newAccount['inPort'];
        inServer.password = newAccount['inPassword'];
        inServer.authMethod = 3;
        inServer.socketType = this.getSocketType(newAccount['inSecurity']);

        account.incomingServer = inServer;

        identity.identityName = newAccount['name'];
        identity.fullName = newAccount['fullName'];
        identity.email = newAccount['inUsername'];

        outServer.description = newAccount['name'];
        outServer.hostname = newAccount['outHost'];
        outServer.port = newAccount['outPort'];
        outServer.username = newAccount['outUsername'];
        outServer.password = newAccount['outPassword'];
        outServer.authMethod = 3;
        outServer.socketType = this.getSocketType(newAccount['outSecurity']);

        identity.smtpServerKey = outServer.key;

        account.addIdentity(identity);
    },

    removeAccount: function (account) {
        try {
            MailServices.smtp.deleteServer(MailServices.smtp.getServerByKey(account.defaultIdentity.smtpServerKey));
        } catch (e) {
        }
        this.nsIMsgAccountManager.removeAccount(account);
    },

    run: function () {
        var self = this;
        this.getFileContent(this.prefs.getCharPref('csv'), function (accounts) {
            self.walkAccounts.call(self, accounts);
        });
    }
};

window.addEventListener('load', function () { AccountManager.startup(); }, false);
window.addEventListener('unload', function () { AccountManager.shutdown(); }, false);