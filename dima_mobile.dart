import 'dart:convert';
import 'dart:io';
import 'package:flutter/material.dart';
import 'package:flutter_localizations/flutter_localizations.dart';

class DimaApp extends StatefulWidget {
  final bool courier;
  const DimaApp({super.key, required this.courier});
  @override
  State<DimaApp> createState() => _DimaAppState();
}

class _DimaAppState extends State<DimaApp> {
  bool french = false;
  @override
  Widget build(BuildContext context) => MaterialApp(
    title: widget.courier ? 'DIMA Livreur' : 'DIMA',
    debugShowCheckedModeBanner: false,
    locale: Locale(french ? 'fr' : 'ar'),
    supportedLocales: const [Locale('ar'), Locale('fr')],
    localizationsDelegates: GlobalMaterialLocalizations.delegates,
    theme: ThemeData(useMaterial3: true, colorScheme: ColorScheme.fromSeed(seedColor: const Color(0xff008779)), scaffoldBackgroundColor: const Color(0xfff5f7f2)),
    home: Home(courier: widget.courier, french: french, toggle: () => setState(() => french = !french)),
  );
}

class Home extends StatefulWidget {
  final bool courier, french;
  final VoidCallback toggle;
  const Home({super.key, required this.courier, required this.french, required this.toggle});
  @override
  State<Home> createState() => _HomeState();
}

class _HomeState extends State<Home> {
  final address = TextEditingController(text: 'عنوان وهمي لاختبار التوصيل في نابل');
  final addressLabel = TextEditingController(text: 'عنوان اختبار في نابل');
  final latitude = TextEditingController(text: '36.46');
  final longitude = TextEditingController(text: '10.73');
  final search = TextEditingController();
  String searchCategory = '';
  List<dynamic> catalogResults = [];
  List<dynamic> savedAddresses = [];
  String? deliveryAddressId;
  Map<String, dynamic>? get deliveryAddress {
    final rows = savedAddresses.where((a) => a['id'] == deliveryAddressId).toList();
    return rows.isEmpty ? null : Map<String, dynamic>.from(rows.first);
  }
  bool get addressDirty => deliveryAddress == null || address.text != deliveryAddress!['text'] || addressLabel.text != deliveryAddress!['label'] || double.tryParse(latitude.text) != deliveryAddress!['latitude'] || double.tryParse(longitude.text) != deliveryAddress!['longitude'];
  void selectAddress(dynamic a, {bool invalidate = true}) {
    deliveryAddressId = a['id']; address.text = a['text']; addressLabel.text = a['label'];
    latitude.text = '${a['latitude']}'; longitude.text = '${a['longitude']}'; if (invalidate) key = null;
  }
  final loginCode = TextEditingController();
  String? accessToken, refreshToken, challengeId, demoCode;
  Future<void>? renewing;
  final Map<String, int> cart = {};
  List<dynamic> stores = [], orders = [];
  Map<String, dynamic>? selected;
  String? key;
  String? error;
  bool busy = false;
  int tab = 0;
  String tr(String ar, String fr) => widget.french ? fr : ar;
  String money(num n) => '${(n / 1000).toStringAsFixed(3)} TND';
  String displayName(dynamic item) => (widget.french ? item['nameFr'] ?? item['name'] : item['name']).toString();
  String statusLabel(dynamic status) {
    const ar = {'placed':'جديد','accepted':'مقبول','preparing':'قيد التحضير','ready':'جاهز','assigned':'تم الإسناد','picked_up':'في الطريق','delivered':'تم التسليم','cancelled':'ملغى'};
    const fr = {'placed':'Nouvelle','accepted':'Acceptée','preparing':'En préparation','ready':'Prête','assigned':'Attribuée','picked_up':'En livraison','delivered':'Livrée','cancelled':'Annulée'};
    return (widget.french ? fr : ar)[status] ?? status.toString();
  }
  static const base = String.fromEnvironment('API_BASE', defaultValue: 'http://10.0.2.2:3000');
  Future<dynamic> raw(String path, {Map<String, dynamic>? body, String? idempotency, String? bearer}) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 10);
    try {
      final req = await client.openUrl(body == null ? 'GET' : 'POST', Uri.parse('$base/v1$path'));
      if (bearer != null) req.headers.set('Authorization', 'Bearer $bearer');
      req.headers.contentType = ContentType.json;
      if (idempotency != null) req.headers.set('Idempotency-Key', idempotency);
      if (body != null) req.write(jsonEncode(body));
      final res = await req.close().timeout(const Duration(seconds: 15));
      final result = jsonDecode(await utf8.decoder.bind(res).join().timeout(const Duration(seconds: 15)));
      if (res.statusCode >= 400) throw ApiFailure(res.statusCode, result['error']['message']);
      return result['data'];
    } finally { client.close(force: true); }
  }
  void acceptSession(dynamic data) {
    if (!mounted) return;
    accessToken = data['accessToken']; refreshToken = data['refreshToken'];
    challengeId = null; demoCode = null; loginCode.clear();
  }
  Future<void> renew() {
    return renewing ??= (() async {
      try { acceptSession(await raw('/auth/refresh', body: {'refreshToken': refreshToken})); }
      catch (_) { accessToken = null; refreshToken = null; rethrow; }
      finally { renewing = null; }
    })();
  }
  Future<dynamic> api(String path, {Map<String, dynamic>? body, String? idempotency}) async {
    if (path == '/stores' || path.startsWith('/stores?') || path.startsWith('/stores/')) return raw(path);
    if (accessToken == null) throw ApiFailure(401, tr('سجّل الدخول أولًا', 'Connectez-vous'));
    try { return await raw(path, body: body, idempotency: idempotency, bearer: accessToken); }
    on ApiFailure catch (e) {
      if (e.status != 401) rethrow;
      await renew();
      return raw(path, body: body, idempotency: idempotency, bearer: accessToken);
    }
  }
  Future<void> signIn({bool verify = false}) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try {
      if (verify) {
        acceptSession(await raw('/auth/verify', body: {'challengeId': challengeId, 'code': loginCode.text.trim()}));
      } else {
        final result = await raw('/auth/challenges', body: {'phone': widget.courier ? '+21600000003' : '+21600000001', 'role': widget.courier ? 'courier' : 'customer'});
        challengeId = result['challengeId']; demoCode = result['demoCode'];
      }
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
    if (verify && accessToken != null && mounted) await refresh();
  }
  Future<void> signOut() async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try { await api('/auth/logout', body: {}); }
    catch (e) { if (mounted) setState(() => error = '$e'); }
    finally {
      accessToken = null; refreshToken = null; challengeId = null; demoCode = null;
      if (mounted) setState(() { orders = []; savedAddresses = []; deliveryAddressId = null; busy = false; });
    }
  }
  @override
  void initState() { super.initState(); refresh(); }
  @override
  void dispose() { address.dispose(); addressLabel.dispose(); latitude.dispose(); longitude.dispose(); search.dispose(); loginCode.dispose(); super.dispose(); }
  String get catalogQuery => Uri(queryParameters: {'q': search.text, 'category': searchCategory}).query;
  Future<void> searchStores() async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try { final rows = await api('/stores?$catalogQuery'); if (mounted) setState(() => catalogResults = rows); }
    catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  bool addProduct(dynamic s, dynamic p) {
    if (busy) return false;
    if (cart.isNotEmpty && selected?['id'] != s['id']) { ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أفرغ سلة المتجر الحالي أولًا', 'Videz le panier actuel')))); return false; }
    if ((cart[p['id']] ?? 0) >= 20) return false;
    setState(() {
      selected = Map<String, dynamic>.from(s);
      cart.removeWhere((id, quantity) => !(s['products'] as List).any((product) => product['id'] == id));
      cart[p['id']] = (cart[p['id']] ?? 0) + 1; key = null;
    }); return true;
  }
  Future<void> showStore(String id) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try {
      final s = await api('/stores/${Uri.encodeComponent(id)}'); if (!mounted) return;
      setState(() => busy = false);
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (context) => Scaffold(appBar: AppBar(title: Text(displayName(s))), body: ListView(padding: const EdgeInsets.all(20), children: [
        Text('${tr('ولاية نابل · التوصيل', 'Nabeul · Livraison')} ${money(s['deliveryMilli'])}'),
        if ((s['products'] as List).isEmpty) Text(tr('لا توجد منتجات متوفرة حاليًا', 'Aucun produit disponible')),
        ...(s['products'] as List).map((p) => ListTile(title: Text(displayName(p)), subtitle: Text(money(p['priceMilli'])), trailing: IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: () { if (addProduct(s, p)) ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text(tr('أضيف إلى السلة', 'Ajouté au panier')))); }))),
      ]))));
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> refresh({bool keepError = false}) async {
    if (busy) return;
    setState(() { busy = true; if (!keepError) error = null; });
    try {
      final results = await Future.wait([api('/stores'), if (accessToken != null) api('/orders'), if (accessToken != null && !widget.courier) api('/addresses')]);
      final matches = !widget.courier && (search.text.isNotEmpty || searchCategory.isNotEmpty) ? await api('/stores?$catalogQuery') : results[0];
      if (mounted) setState(() {
        stores = results[0]; catalogResults = matches; orders = results.length > 1 ? results[1] : [];
        final priorAddress = deliveryAddress;
        savedAddresses = results.length > 2 ? results[2] : [];
        if (savedAddresses.isNotEmpty) {
          final matches = savedAddresses.where((a) => a['id'] == deliveryAddressId).toList();
          selectAddress(matches.isNotEmpty ? matches.first : savedAddresses.first, invalidate: false);
        } else { deliveryAddressId = null; }
        if (priorAddress?['id'] != deliveryAddress?['id'] || priorAddress?['version'] != deliveryAddress?['version']) key = null;
        final priorItems = jsonEncode(cart);
        if (selected != null) {
          final matches = stores.where((s) => s['id'] == selected!['id']).toList();
          if (matches.isEmpty) { selected = null; cart.clear(); }
          else {
            selected = Map<String, dynamic>.from(matches.first);
            cart.removeWhere((id, quantity) => !(selected!['products'] as List).any((p) => p['id'] == id));
          }
        }
        if (priorItems != jsonEncode(cart)) key = null;
      });
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> saveAddress({bool edit = false, bool archive = false}) async {
    if (busy || accessToken == null) return;
    final selectedAddress = deliveryAddress;
    if ((edit || archive) && selectedAddress == null) return;
    setState(() { busy = true; error = null; });
    try {
      final body = archive ? <String, dynamic>{'version': selectedAddress!['version']} : <String, dynamic>{'label': addressLabel.text, 'text': address.text, 'latitude': double.tryParse(latitude.text), 'longitude': double.tryParse(longitude.text), if (edit) 'version': selectedAddress!['version']};
      final path = archive ? '/addresses/${selectedAddress!['id']}/archive' : edit ? '/addresses/${selectedAddress!['id']}' : '/addresses';
      final result = await api(path, body: body); deliveryAddressId = archive ? null : result['id']; key = null;
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
    await refresh(keepError: true);
  }
  Future<void> showOrder(String id) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try {
      final o = await api('/orders/$id');
      if (!mounted) return;
      await Navigator.of(context).push(MaterialPageRoute<void>(builder: (context) => Scaffold(appBar: AppBar(title: Text(tr('تفاصيل الطلب', 'Détail de commande'))), body: ListView(padding: const EdgeInsets.all(20), children: [
        Text(statusLabel(o['status']), style: Theme.of(context).textTheme.headlineSmall),
        if (o['address'] != null) Text(o['address']),
        ...((o['items'] ?? []) as List).map((item) => ListTile(title: Text('${displayName(item)} × ${item['quantity']}'), trailing: Text(money(item['priceMilli'] * item['quantity'])))),
        if (o['totalMilli'] != null) Text('${tr('الإجمالي', 'Total')} ${money(o['totalMilli'])}'),
        ...((o['events'] ?? []) as List).map((event) => ListTile(leading: const Icon(Icons.check_circle_outline), title: Text(statusLabel(event['status'])), subtitle: Text('${event['at']} UTC'))),
      ]))));
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
  }
  Future<void> submit() async {
    if (busy || selected == null || cart.isEmpty || accessToken == null || addressDirty || deliveryAddress?['serviceable'] != true) return;
    setState(() { busy = true; error = null; });
    key ??= 'mobile-${DateTime.now().microsecondsSinceEpoch}';
    try {
      final quote = cart.entries.fold<int>(selected!['deliveryMilli'] as int, (sum, e) => sum + ((selected!['products'] as List).firstWhere((p) => p['id'] == e.key)['priceMilli'] as int) * e.value);
      await api('/orders', body: {'storeId': selected!['id'], 'addressId': deliveryAddress!['id'], 'addressVersion': deliveryAddress!['version'], 'quoteTotalMilli': quote, 'items': cart.entries.map((e) => {'productId': e.key, 'quantity': e.value}).toList()}, idempotency: key);
      if (mounted) setState(() { cart.clear(); key = null; tab = 2; });
    } catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
    await refresh(keepError: true);
  }
  Future<void> transition(Map<String, dynamic> o, String status) async {
    if (busy) return;
    setState(() { busy = true; error = null; });
    try { await api('/orders/${o['id']}/status', body: {'status': status, 'version': o['version']}); }
    catch (e) { if (mounted) setState(() => error = '$e'); }
    finally { if (mounted) setState(() => busy = false); }
    await refresh(keepError: true);
  }
  Widget orderCard(dynamic raw) {
    final o = Map<String, dynamic>.from(raw);
    final next = widget.courier ? {'ready':'assigned', 'assigned':'picked_up', 'picked_up':'delivered'}[o['status']] : (o['status'] == 'placed' ? 'cancelled' : null);
    final titles = {'assigned': tr('قبول التوصيل', 'Accepter la course'), 'picked_up': tr('استلمت الطلب', 'Commande récupérée'), 'delivered': tr('تم التسليم', 'Livrée'), 'cancelled': tr('إلغاء', 'Annuler')};
    return Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
      Text('${o['id'].toString().substring(0,8)} · ${statusLabel(o['status'])}', style: const TextStyle(fontWeight: FontWeight.bold)),
      if (o['address'] != null) Text(o['address']),
      if (o['totalMilli'] != null) Text(money(o['totalMilli'])),
      OutlinedButton(onPressed: busy ? null : () => showOrder(o['id']), child: Text(tr('تفاصيل الطلب', 'Détails'))),
      if (next != null) FilledButton(onPressed: busy ? null : () => transition(o, next), child: Text(titles[next]!)),
    ])));
  }
  @override
  Widget build(BuildContext context) {
    final products = selected == null ? <dynamic>[] : selected!['products'] as List<dynamic>;
    final total = cart.entries.fold<int>(0, (sum, e) => sum + (products.firstWhere((p) => p['id'] == e.key)['priceMilli'] as int) * e.value) + (cart.isEmpty ? 0 : selected!['deliveryMilli'] as int);
    return Scaffold(
      appBar: AppBar(title: Text(widget.courier ? 'DIMA · ${tr('المندوب', 'Livreur')}' : 'DIMA'), actions: [TextButton(onPressed: widget.toggle, child: Text(widget.french ? 'العربية' : 'FR')), IconButton(onPressed: busy ? null : refresh, icon: const Icon(Icons.refresh))]),
      body: ListView(padding: const EdgeInsets.all(20), children: [
        Text(tr('نطاق الإطلاق: ولاية نابل · نسخة تجريبية دون تشغيل فعلي', 'Lancement cible : gouvernorat de Nabeul · démonstration')),
        if (busy) const LinearProgressIndicator(),
        if (error != null) Text(error!, style: const TextStyle(color: Colors.red)),
        Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(tr('دخول تجريبي · لا تُرسل رسائل SMS', 'Connexion fictive · aucun SMS envoyé')),
          Text(widget.courier ? '+21600000003' : '+21600000001', textDirection: TextDirection.ltr),
          if (accessToken == null) ...[
            FilledButton(onPressed: busy ? null : () => signIn(), child: Text(tr('طلب رمز تجريبي', 'Demander un code'))),
            if (challengeId != null) ...[
              Text('${tr('رمز الاختبار الظاهر', 'Code de démonstration')} : $demoCode'),
              TextField(controller: loginCode, enabled: !busy, keyboardType: TextInputType.number, maxLength: 6, decoration: InputDecoration(labelText: tr('رمز التحقق', 'Code'))),
              FilledButton(onPressed: busy ? null : () => signIn(verify: true), child: Text(tr('تأكيد الدخول', 'Se connecter'))),
            ],
          ] else OutlinedButton(onPressed: busy ? null : signOut, child: Text(tr('تسجيل الخروج', 'Se déconnecter'))),
        ]))),
        if (widget.courier || tab == 2) ...[
          Text(tr('طلبات التوصيل', 'Commandes'), style: Theme.of(context).textTheme.headlineMedium),
          if (orders.isEmpty) Text(tr('لا توجد طلبات. اضغط التحديث لاحقًا.', 'Aucune commande. Actualisez plus tard.')),
          ...orders.map(orderCard),
        ] else if (tab == 0) ...[
          Container(padding: const EdgeInsets.all(24), decoration: BoxDecoration(color: const Color(0xff008779), borderRadius: BorderRadius.circular(24)), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(tr('يومك أسهل مع DIMA', 'Votre quotidien, livré.'), style: const TextStyle(fontSize: 28, fontWeight: FontWeight.bold, color: Colors.white)), const SizedBox(height: 12), Text(tr('مطاعم ومقاضي من حيك في تونس', 'Restaurants et courses de votre quartier'), style: const TextStyle(color: Colors.white))])),
          const SizedBox(height: 20),
          TextField(controller: search, enabled: !busy, maxLength: 80, onSubmitted: (_) => searchStores(), decoration: InputDecoration(labelText: tr('ابحث عن متجر أو منتج', 'Chercher un commerce ou un produit'), suffixIcon: IconButton(onPressed: busy ? null : searchStores, icon: const Icon(Icons.search)))),
          DropdownButtonFormField<String>(value: searchCategory, items: [DropdownMenuItem(value: '', child: Text(tr('الكل', 'Tout'))), DropdownMenuItem(value: 'restaurants', child: Text(tr('مطاعم', 'Restaurants'))), DropdownMenuItem(value: 'groceries', child: Text(tr('مقاضي', 'Courses')))], onChanged: busy ? null : (value) { setState(() => searchCategory = value ?? ''); searchStores(); }),
          if (catalogResults.isEmpty) Text(tr('لا توجد متاجر تطابق البحث', 'Aucun commerce ne correspond')),
          ...catalogResults.map((s) => Card(child: Padding(padding: const EdgeInsets.all(16), child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [Text(displayName(s), style: Theme.of(context).textTheme.titleLarge), Text('${tr('التوصيل', 'Livraison')} ${money(s['deliveryMilli'])}'), OutlinedButton(onPressed: busy ? null : () => showStore(s['id']), child: Text(tr('عرض المتجر', 'Voir le commerce'))), ...((s['products'] as List).map((p) => ListTile(title: Text(displayName(p)), subtitle: Text(money(p['priceMilli'])), trailing: IconButton(icon: const Icon(Icons.add_circle_outline), onPressed: busy ? null : () => addProduct(s, p)))))])))),
        ] else ...[
          Text(tr('سلة الطلب', 'Panier'), style: Theme.of(context).textTheme.headlineMedium),
          ...cart.entries.map((e) => ListTile(title: Text('${products.firstWhere((p) => p['id'] == e.key)['name']} × ${e.value}'), trailing: IconButton(icon: const Icon(Icons.remove_circle_outline), onPressed: busy ? null : () => setState(() { if (e.value == 1) { cart.remove(e.key); } else { cart[e.key] = e.value - 1; } key = null; })))),
          if (savedAddresses.isNotEmpty) DropdownButtonFormField<String>(value: deliveryAddressId, decoration: InputDecoration(labelText: tr('عنوان محفوظ', 'Adresse enregistrée')), items: savedAddresses.map((a) => DropdownMenuItem<String>(value: a['id'], child: Text('${a['label']} · ${a['serviceable'] == true ? tr('داخل النطاق المرجعي', 'Dans la zone') : tr('خارج النطاق', 'Hors zone')}'))).toList(), onChanged: busy ? null : (id) => setState(() => selectAddress(savedAddresses.firstWhere((a) => a['id'] == id)))),
          Text(tr('العنوان والإحداثيات أمثلة وهمية. احفظ أي تعديل قبل تأكيد الطلب.', 'Adresse et coordonnées fictives. Enregistrez les changements avant la commande.')),
          TextField(controller: addressLabel, enabled: !busy, onChanged: (_) => setState(() => key = null), maxLength: 60, decoration: InputDecoration(labelText: tr('اسم العنوان', 'Libellé'))),
          TextField(controller: address, enabled: !busy, onChanged: (_) => setState(() => key = null), maxLength: 300, decoration: InputDecoration(labelText: tr('العنوان', 'Adresse'))),
          TextField(controller: latitude, enabled: !busy, onChanged: (_) => setState(() => key = null), keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: tr('خط العرض', 'Latitude'))),
          TextField(controller: longitude, enabled: !busy, onChanged: (_) => setState(() => key = null), keyboardType: const TextInputType.numberWithOptions(decimal: true, signed: true), decoration: InputDecoration(labelText: tr('خط الطول', 'Longitude'))),
          Wrap(spacing: 8, children: [OutlinedButton(onPressed: busy || accessToken == null ? null : () => saveAddress(), child: Text(tr('حفظ كعنوان جديد', 'Ajouter'))), OutlinedButton(onPressed: busy || deliveryAddress == null ? null : () => saveAddress(edit: true), child: Text(tr('تحديث المحدد', 'Modifier'))), OutlinedButton(onPressed: busy || deliveryAddress == null ? null : () => saveAddress(archive: true), child: Text(tr('إزالة المحدد', 'Archiver')))]),
          Text('${tr('الإجمالي مع التوصيل', 'Total avec livraison')} ${money(total)}'),
          FilledButton(onPressed: busy || cart.isEmpty || accessToken == null || addressDirty || deliveryAddress?['serviceable'] != true ? null : submit, child: Text(tr('تأكيد · نقدًا عند الاستلام', 'Confirmer · Paiement à la livraison'))),
        ],
      ]),
      bottomNavigationBar: widget.courier ? null : NavigationBar(selectedIndex: tab, onDestinationSelected: (i) => setState(() => tab = i), destinations: [NavigationDestination(icon: const Icon(Icons.storefront), label: tr('اكتشف', 'Explorer')), NavigationDestination(icon: Badge(label: Text('${cart.length}'), child: const Icon(Icons.shopping_bag_outlined)), label: tr('السلة', 'Panier')), NavigationDestination(icon: const Icon(Icons.receipt_long), label: tr('طلباتي', 'Commandes'))]),
    );
  }
}

class ApiFailure implements Exception {
  final int status;
  final String message;
  ApiFailure(this.status, this.message);
  @override
  String toString() => message;
}
