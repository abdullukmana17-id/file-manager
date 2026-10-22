$routes->group('api', ['namespace' => 'App\Controllers', 'filter' => 'cors'], static function ($routes) {
    $routes->get('files', 'FileController::index');
    $routes->post('files', 'FileController::create');
    $routes->get('files/(:num)', 'FileController::show/$1');
    $routes->put('files/(:num)', 'FileController::update/$1');
    $routes->patch('files/(:num)', 'FileController::update/$1');
    $routes->delete('files/(:num)', 'FileController::delete/$1');
    $routes->get('files/(:num)/download', 'FileController::download/$1');
    $routes->get('files/(:num)/view', 'FileController::view/$1');

    $routes->options('(:any)', static function () {});
});
