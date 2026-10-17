FROM nginx:1.27-alpine

# Keep the project file named nginx.conf, but install it in the official
# image's template directory so environment variables are substituted at startup.
COPY nginx.conf /etc/nginx/templates/default.conf.template

EXPOSE 80 8081
