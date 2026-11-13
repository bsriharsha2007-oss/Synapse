FROM php:8.3-apache

# Install SQLite3 and fileinfo extensions, and enable Apache URL rewriting
RUN apt-get update && apt-get install -y libsqlite3-dev \
    && docker-php-ext-install pdo pdo_sqlite fileinfo \
    && a2enmod rewrite

# Point Apache DocumentRoot to the public/ folder and enable .htaccess overrides
ENV APACHE_DOCUMENT_ROOT /var/www/html/public
RUN sed -ri -e 's!/var/www/html!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/sites-available/*.conf \
    && sed -ri -e 's!/var/www/!${APACHE_DOCUMENT_ROOT}!g' /etc/apache2/apache2.conf /etc/apache2/conf-available/*.conf \
    && printf '<Directory /var/www/html/public>\n    AllowOverride All\n    Require all granted\n</Directory>\n' > /etc/apache2/conf-available/synapse-public.conf \
    && a2enconf synapse-public

# Enable PHP error logging to Render's console output
RUN echo "log_errors = On\nerror_log = /dev/stderr\nerror_reporting = E_ALL" > /usr/local/etc/php/conf.d/error-logging.ini
ENV SYNAPSE_DB_PATH /var/lib/synapse/synapse.db

# Copy application files
COPY database.php /var/www/html/database.php
COPY public/ /var/www/html/public/

# Create a private, writable directory for SQLite
RUN mkdir -p /var/lib/synapse && chown -R www-data:www-data /var/lib/synapse && chmod 770 /var/lib/synapse

EXPOSE 80