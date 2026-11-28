-- Seed trusted Monid table-type defaults. Existing admin-edited definitions are preserved on redeploy.
INSERT INTO enrichable.table_types (id, definition)
SELECT entry->>'id', entry
FROM jsonb_array_elements($monid_table_type_seed_032$[
  {
    "id": "1688-wholesale-offers",
    "category": "Products & Shopping",
    "name": "1688 Wholesale Offers",
    "description": "Search 1688 supplier offers and keep one offer per row.",
    "instructions": "Use the product request as the 1688 keyword query. Optional exact-title matching is strict and may drop offers phrased differently. Keep each offer distinct and preserve its provider ID or a deterministic URL/SKU-based key.",
    "examplePrompts": [
      "Insulated stainless steel bottles for wholesale",
      "Custom printed shipping mailers with low minimum order quantity"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "exact-match",
        "label": "Exact title match",
        "description": "Strictly keep offers whose title contains every query word. This may remove relevant offers phrased differently.",
        "type": "select",
        "options": [
          {
            "label": "Off",
            "value": "false"
          },
          {
            "label": "On",
            "value": "true"
          }
        ],
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Offer key",
        "field": "Offer key",
        "width": 180
      },
      {
        "name": "Offer ID",
        "field": "Offer ID",
        "width": 180
      },
      {
        "name": "Title",
        "field": "Title",
        "width": 180
      },
      {
        "name": "Supplier",
        "field": "Supplier",
        "width": 180
      },
      {
        "name": "Offer type",
        "field": "Offer type",
        "width": 180
      },
      {
        "name": "SKU",
        "field": "SKU",
        "width": 180
      },
      {
        "name": "Minimum order quantity",
        "field": "Minimum order quantity",
        "width": 180
      },
      {
        "name": "Units sold",
        "field": "Units sold",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "width": 180
      },
      {
        "name": "Review count",
        "field": "Review count",
        "width": 180
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 180
      },
      {
        "name": "Price range",
        "field": "Price range",
        "width": 180
      },
      {
        "name": "Price in CNY",
        "field": "Price in CNY",
        "width": 180
      },
      {
        "name": "Stock",
        "field": "Stock",
        "width": 180
      },
      {
        "name": "Supplier location",
        "field": "Supplier location",
        "width": 180
      },
      {
        "name": "Image",
        "field": "Image",
        "format": "url",
        "width": 180
      },
      {
        "name": "Product URL",
        "field": "Product URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "Supplier URL",
        "field": "Supplier URL",
        "format": "url",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Offer key",
      "normalization": "text"
    },
    "operations": [
      "table.1688.search"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Offer key",
        "columnName": "Offer key"
      },
      {
        "sourceField": "Offer ID",
        "columnName": "Offer ID"
      },
      {
        "sourceField": "Title",
        "columnName": "Title"
      },
      {
        "sourceField": "Supplier",
        "columnName": "Supplier"
      },
      {
        "sourceField": "Offer type",
        "columnName": "Offer type"
      },
      {
        "sourceField": "SKU",
        "columnName": "SKU"
      },
      {
        "sourceField": "Minimum order quantity",
        "columnName": "Minimum order quantity"
      },
      {
        "sourceField": "Units sold",
        "columnName": "Units sold"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Review count",
        "columnName": "Review count"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Price range",
        "columnName": "Price range"
      },
      {
        "sourceField": "Price in CNY",
        "columnName": "Price in CNY"
      },
      {
        "sourceField": "Stock",
        "columnName": "Stock"
      },
      {
        "sourceField": "Supplier location",
        "columnName": "Supplier location"
      },
      {
        "sourceField": "Image",
        "columnName": "Image"
      },
      {
        "sourceField": "Product URL",
        "columnName": "Product URL"
      },
      {
        "sourceField": "Supplier URL",
        "columnName": "Supplier URL"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "product-search",
    "category": "Products & Shopping",
    "name": "Retail Product Search",
    "description": "Search products and retailer offers across supported stores.",
    "instructions": "Use the prompt as the product query. Keep each canonical product as one row and retain the product ID and available retailer offer links.",
    "examplePrompts": [
      "Noise-cancelling headphones under $200",
      "Reusable glass water bottles in stock"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Product ID",
        "field": "Product ID",
        "width": 150
      },
      {
        "name": "Product",
        "field": "Title",
        "width": 260
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 320
      },
      {
        "name": "Brand",
        "field": "Brand",
        "width": 140
      },
      {
        "name": "Category",
        "field": "Category",
        "width": 170
      },
      {
        "name": "Product URL",
        "field": "Product URL",
        "format": "url",
        "width": 240
      },
      {
        "name": "Image",
        "field": "Image",
        "format": "url",
        "width": 150
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 130
      },
      {
        "name": "Availability",
        "field": "Availability",
        "width": 120
      },
      {
        "name": "Condition",
        "field": "Condition",
        "width": 120
      },
      {
        "name": "Rating",
        "field": "Rating",
        "format": "number",
        "width": 90
      },
      {
        "name": "Review count",
        "field": "Review count",
        "format": "number",
        "width": 110
      },
      {
        "name": "Variants",
        "field": "Variants",
        "width": 200
      },
      {
        "name": "Retailer",
        "field": "Retailer",
        "width": 160
      }
    ],
    "identity": {
      "sourceField": "Product ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.channel3.search"
    ],
    "pagination": {
      "strategy": "cursor",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Product ID",
        "columnName": "Product ID"
      },
      {
        "sourceField": "Title",
        "columnName": "Product"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Brand",
        "columnName": "Brand"
      },
      {
        "sourceField": "Category",
        "columnName": "Category"
      },
      {
        "sourceField": "Product URL",
        "columnName": "Product URL"
      },
      {
        "sourceField": "Image",
        "columnName": "Image"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Availability",
        "columnName": "Availability"
      },
      {
        "sourceField": "Condition",
        "columnName": "Condition"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Review count",
        "columnName": "Review count"
      },
      {
        "sourceField": "Variants",
        "columnName": "Variants"
      },
      {
        "sourceField": "Retailer",
        "columnName": "Retailer"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "shopify-catalog",
    "category": "Products & Shopping",
    "name": "Shopify Store Catalog",
    "description": "Page through the published catalog for a Shopify store.",
    "instructions": "Use the explicit Shopify store subdomain. Each catalog product is one row and includes a stable product URL or ID.",
    "examplePrompts": [
      "List the products in the Allbirds Shopify catalog",
      "Show products from myshop storefront"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "store",
        "label": "Shopify store",
        "description": "Store subdomain only, without https:// or .myshopify.com.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Product URL",
        "field": "Product URL",
        "format": "url",
        "width": 240
      },
      {
        "name": "Product ID",
        "field": "Product ID",
        "width": 150
      },
      {
        "name": "Product",
        "field": "Title",
        "width": 260
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 320
      },
      {
        "name": "Vendor",
        "field": "Vendor",
        "width": 160
      },
      {
        "name": "Product type",
        "field": "Product type",
        "width": 150
      },
      {
        "name": "Handle",
        "field": "Handle",
        "width": 160
      },
      {
        "name": "Images",
        "field": "Images",
        "width": 200
      },
      {
        "name": "Variants",
        "field": "Variants",
        "width": 200
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 130
      },
      {
        "name": "Availability",
        "field": "Availability",
        "width": 120
      }
    ],
    "identity": {
      "sourceField": "Product ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.shopify.products"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Product URL",
        "columnName": "Product URL"
      },
      {
        "sourceField": "Product ID",
        "columnName": "Product ID"
      },
      {
        "sourceField": "Title",
        "columnName": "Product"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Vendor",
        "columnName": "Vendor"
      },
      {
        "sourceField": "Product type",
        "columnName": "Product type"
      },
      {
        "sourceField": "Handle",
        "columnName": "Handle"
      },
      {
        "sourceField": "Images",
        "columnName": "Images"
      },
      {
        "sourceField": "Variants",
        "columnName": "Variants"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Availability",
        "columnName": "Availability"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "local-business-search",
    "category": "Places & Local Businesses",
    "name": "Local Business Search",
    "description": "Search local business listings using Yelp or Google Maps.",
    "instructions": "Choose one source. Enter a city for Yelp. Google Maps can use a location in the prompt or the optional location input. The provider-qualified Business key is used for stable deduplication.",
    "examplePrompts": [
      "Independent bakeries in San Francisco",
      "HVAC contractors in Austin, TX"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "source",
        "label": "Business source",
        "description": "Choose one provider for this search.",
        "type": "select",
        "options": [
          {
            "label": "Google Maps",
            "value": "google-maps"
          },
          {
            "label": "Yelp",
            "value": "yelp"
          }
        ],
        "required": true
      },
      {
        "key": "location",
        "label": "City or region",
        "description": "Required for Yelp\u003b optional for Google Maps.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Business key",
        "field": "Business key",
        "width": 180
      },
      {
        "name": "Provider",
        "field": "Provider",
        "width": 180
      },
      {
        "name": "Provider ID",
        "field": "Provider ID",
        "width": 180
      },
      {
        "name": "Business",
        "field": "Business",
        "width": 180
      },
      {
        "name": "Category",
        "field": "Category",
        "width": 180
      },
      {
        "name": "Address",
        "field": "Address",
        "width": 180
      },
      {
        "name": "Phone",
        "field": "Phone",
        "width": 180
      },
      {
        "name": "Website",
        "field": "Website",
        "format": "url",
        "width": 180
      },
      {
        "name": "Business URL",
        "field": "Business URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "width": 180
      },
      {
        "name": "Review count",
        "field": "Review count",
        "width": 180
      },
      {
        "name": "Price level",
        "field": "Price level",
        "width": 180
      },
      {
        "name": "Hours",
        "field": "Hours",
        "width": 180
      },
      {
        "name": "Latitude",
        "field": "Latitude",
        "width": 180
      },
      {
        "name": "Longitude",
        "field": "Longitude",
        "width": 180
      },
      {
        "name": "Image",
        "field": "Image",
        "format": "url",
        "width": 180
      },
      {
        "name": "Price range",
        "field": "Price range",
        "width": 180
      },
      {
        "name": "Categories",
        "field": "Categories",
        "width": 180
      },
      {
        "name": "Cuisine",
        "field": "Cuisine",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "City",
        "field": "City",
        "width": 180
      },
      {
        "name": "Region",
        "field": "Region",
        "width": 180
      },
      {
        "name": "Postal code",
        "field": "Postal code",
        "width": 180
      },
      {
        "name": "Country",
        "field": "Country",
        "width": 180
      },
      {
        "name": "Verified",
        "field": "Verified",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Business key",
      "normalization": "text"
    },
    "operations": [
      "table.yelp.search",
      "table.google.maps"
    ],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Business key",
        "columnName": "Business key"
      },
      {
        "sourceField": "Provider",
        "columnName": "Provider"
      },
      {
        "sourceField": "Provider ID",
        "columnName": "Provider ID"
      },
      {
        "sourceField": "Business",
        "columnName": "Business"
      },
      {
        "sourceField": "Category",
        "columnName": "Category"
      },
      {
        "sourceField": "Address",
        "columnName": "Address"
      },
      {
        "sourceField": "Phone",
        "columnName": "Phone"
      },
      {
        "sourceField": "Website",
        "columnName": "Website"
      },
      {
        "sourceField": "Business URL",
        "columnName": "Business URL"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Review count",
        "columnName": "Review count"
      },
      {
        "sourceField": "Price level",
        "columnName": "Price level"
      },
      {
        "sourceField": "Hours",
        "columnName": "Hours"
      },
      {
        "sourceField": "Latitude",
        "columnName": "Latitude"
      },
      {
        "sourceField": "Longitude",
        "columnName": "Longitude"
      },
      {
        "sourceField": "Image",
        "columnName": "Image"
      },
      {
        "sourceField": "Price range",
        "columnName": "Price range"
      },
      {
        "sourceField": "Categories",
        "columnName": "Categories"
      },
      {
        "sourceField": "Cuisine",
        "columnName": "Cuisine"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "City",
        "columnName": "City"
      },
      {
        "sourceField": "Region",
        "columnName": "Region"
      },
      {
        "sourceField": "Postal code",
        "columnName": "Postal code"
      },
      {
        "sourceField": "Country",
        "columnName": "Country"
      },
      {
        "sourceField": "Verified",
        "columnName": "Verified"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "yelp-reviews",
    "category": "Reviews & Reputation",
    "name": "Yelp Reviews",
    "description": "Resolve a Yelp business and page through its reviews.",
    "instructions": "Use the business name in the prompt and provide its city, or enter a Yelp business URL to skip resolution. Each review is one row and retains its review ID, business name, and Yelp business URL.",
    "examplePrompts": [
      "Get the reviews for Tartine Bakery in San Francisco",
      "Review sentiment for https://www.yelp.com/biz/example-business"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "location",
        "label": "Business city or ZIP code",
        "description": "Used to resolve the Yelp business when no Yelp business URL is provided.",
        "type": "text",
        "required": false
      },
      {
        "key": "business-url",
        "label": "Yelp business URL",
        "description": "Optional direct Yelp /biz/ URL\u003b this skips business resolution.",
        "type": "url",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Review ID",
        "field": "Review ID",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "format": "number",
        "width": 90
      },
      {
        "name": "Review",
        "field": "Review",
        "width": 480
      },
      {
        "name": "Date",
        "field": "Date",
        "width": 180
      },
      {
        "name": "Reviewer",
        "field": "Reviewer",
        "width": 170
      },
      {
        "name": "Business",
        "field": "Business",
        "width": 200
      },
      {
        "name": "Business URL",
        "field": "Business URL",
        "format": "url",
        "width": 260
      },
      {
        "name": "Helpful votes",
        "field": "Helpful votes",
        "format": "number",
        "width": 120
      },
      {
        "name": "Photo count",
        "field": "Photo count",
        "format": "number",
        "width": 110
      }
    ],
    "identity": {
      "sourceField": "Review ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.yelp.search",
      "table.yelp.reviews"
    ],
    "pagination": {
      "strategy": "cursor",
      "maxCalls": 20
    },
    "chaining": {
      "enabled": true,
      "operations": [
        "table.yelp.reviews"
      ]
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Review ID",
        "columnName": "Review ID"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Review",
        "columnName": "Review"
      },
      {
        "sourceField": "Date",
        "columnName": "Date"
      },
      {
        "sourceField": "Reviewer",
        "columnName": "Reviewer"
      },
      {
        "sourceField": "Business",
        "columnName": "Business"
      },
      {
        "sourceField": "Business URL",
        "columnName": "Business URL"
      },
      {
        "sourceField": "Helpful votes",
        "columnName": "Helpful votes"
      },
      {
        "sourceField": "Photo count",
        "columnName": "Photo count"
      }
    ]
  },
  {
    "id": "tripadvisor-places",
    "category": "Places & Local Businesses",
    "name": "Tripadvisor Places",
    "description": "Search Tripadvisor for hotels, restaurants, attractions, and places.",
    "instructions": "Use the prompt as a Tripadvisor search query. Each place is one row and keeps its Tripadvisor place ID for follow-on detail or review enrichment.",
    "examplePrompts": [
      "Family hotels in Lisbon near the city center",
      "Museums and attractions in Kyoto"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Place ID",
        "field": "Place ID",
        "width": 160
      },
      {
        "name": "Place",
        "field": "Place",
        "width": 240
      },
      {
        "name": "Type",
        "field": "Type",
        "width": 140
      },
      {
        "name": "Rating",
        "field": "Rating",
        "format": "number",
        "width": 90
      },
      {
        "name": "Review count",
        "field": "Review count",
        "format": "number",
        "width": 110
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 220
      },
      {
        "name": "Address",
        "field": "Address",
        "width": 240
      },
      {
        "name": "Place URL",
        "field": "Place URL",
        "format": "url",
        "width": 250
      }
    ],
    "identity": {
      "sourceField": "Place ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.tripadvisor.search"
    ],
    "pagination": {
      "strategy": "offset",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Place ID",
        "columnName": "Place ID"
      },
      {
        "sourceField": "Place",
        "columnName": "Place"
      },
      {
        "sourceField": "Type",
        "columnName": "Type"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Review count",
        "columnName": "Review count"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      },
      {
        "sourceField": "Address",
        "columnName": "Address"
      },
      {
        "sourceField": "Place URL",
        "columnName": "Place URL"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "tripadvisor-reviews",
    "category": "Reviews & Reputation",
    "name": "Tripadvisor Reviews",
    "description": "Resolve a Tripadvisor place and fetch its reviews.",
    "instructions": "Search a place by name, or provide a Tripadvisor place ID to skip resolution. Each review is a row. Since the inspected endpoint has no provider review ID, rows use a deterministic hash of place, reviewer, date, title and review text.",
    "examplePrompts": [
      "Get hotel reviews for the Grand Hyatt Tokyo",
      "Reviews for this Tripadvisor place ID"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "place-id",
        "label": "Tripadvisor place ID",
        "description": "Optional positive Tripadvisor place ID to skip search.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Review key",
        "field": "Review key",
        "width": 220
      },
      {
        "name": "Title",
        "field": "Title",
        "width": 220
      },
      {
        "name": "Review",
        "field": "Review",
        "width": 480
      },
      {
        "name": "Rating",
        "field": "Rating",
        "format": "number",
        "width": 90
      },
      {
        "name": "Date",
        "field": "Date",
        "width": 160
      },
      {
        "name": "Trip type",
        "field": "Trip type",
        "width": 140
      },
      {
        "name": "Reviewer",
        "field": "Reviewer",
        "width": 180
      },
      {
        "name": "Place",
        "field": "Place",
        "width": 200
      },
      {
        "name": "Place ID",
        "field": "Place ID",
        "width": 160
      },
      {
        "name": "Place URL",
        "field": "Place URL",
        "format": "url",
        "width": 250
      }
    ],
    "identity": {
      "sourceField": "Review key",
      "normalization": "text"
    },
    "operations": [
      "table.tripadvisor.search",
      "table.tripadvisor.reviews"
    ],
    "pagination": {
      "strategy": "offset",
      "maxCalls": 20
    },
    "chaining": {
      "enabled": true,
      "operations": [
        "table.tripadvisor.reviews"
      ]
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Review key",
        "columnName": "Review key"
      },
      {
        "sourceField": "Title",
        "columnName": "Title"
      },
      {
        "sourceField": "Review",
        "columnName": "Review"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Date",
        "columnName": "Date"
      },
      {
        "sourceField": "Trip type",
        "columnName": "Trip type"
      },
      {
        "sourceField": "Reviewer",
        "columnName": "Reviewer"
      },
      {
        "sourceField": "Place",
        "columnName": "Place"
      },
      {
        "sourceField": "Place ID",
        "columnName": "Place ID"
      },
      {
        "sourceField": "Place URL",
        "columnName": "Place URL"
      }
    ]
  },
  {
    "id": "nonprofit-organizations",
    "category": "Companies & Organizations",
    "name": "Nonprofit Organizations",
    "description": "Search Idealist’s nonprofit organization directory.",
    "instructions": "Use the prompt for organization keywords. Optional coordinates constrain the geographic search. Idealist returns a paged directory list.",
    "examplePrompts": [
      "Food banks and hunger relief organizations in Oakland",
      "Animal rescue nonprofits in Oregon"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "coordinates",
        "label": "Coordinates",
        "description": "Optional latitude,longitude pair for geographic filtering.",
        "type": "text",
        "required": false
      },
      {
        "key": "organization-type",
        "label": "Organization type",
        "description": "Optional Idealist organization classification.",
        "type": "select",
        "options": [
          {
            "label": "Nonprofit",
            "value": "NONPROFIT"
          },
          {
            "label": "Social enterprise",
            "value": "SOCIAL_ENTERPRISE"
          },
          {
            "label": "B Corp",
            "value": "B_CORP"
          }
        ],
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Organization ID",
        "field": "Organization ID",
        "width": 180
      },
      {
        "name": "Organization",
        "field": "Organization",
        "width": 240
      },
      {
        "name": "City",
        "field": "City",
        "width": 150
      },
      {
        "name": "Type",
        "field": "Type",
        "width": 140
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 360
      },
      {
        "name": "Hiring",
        "field": "Hiring",
        "width": 100
      }
    ],
    "identity": {
      "sourceField": "Organization ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.idealist.organizations"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Organization ID",
        "columnName": "Organization ID"
      },
      {
        "sourceField": "Organization",
        "columnName": "Organization"
      },
      {
        "sourceField": "City",
        "columnName": "City"
      },
      {
        "sourceField": "Type",
        "columnName": "Type"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Hiring",
        "columnName": "Hiring"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "startup-jobs",
    "category": "Jobs & Careers",
    "name": "Startup Jobs",
    "description": "Search paginated Wellfound startup job listings.",
    "instructions": "Choose a Wellfound role slug in the extra input. Use the prompt to describe seniority, startup stage, and other criteria\u003b use the optional location slug to narrow results. This type remains a draft until the catalog confirms a stable job ID or URL in results.",
    "examplePrompts": [
      "Remote product manager roles at seed startups",
      "Senior software engineer jobs in San Francisco"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "role",
        "label": "Wellfound role slug",
        "description": "Required role slug such as product-manager or software-engineer.",
        "type": "text",
        "required": true
      },
      {
        "key": "location",
        "label": "Wellfound location slug",
        "description": "Optional slug such as remote or san-francisco.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Job URL",
        "field": "Job URL",
        "format": "url",
        "width": 250
      },
      {
        "name": "Job ID",
        "field": "Job ID",
        "width": 150
      },
      {
        "name": "Title",
        "field": "Title",
        "width": 220
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 200
      },
      {
        "name": "Company URL",
        "field": "Company URL",
        "format": "url",
        "width": 220
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 180
      },
      {
        "name": "Remote",
        "field": "Remote",
        "width": 100
      },
      {
        "name": "Salary",
        "field": "Salary",
        "width": 160
      },
      {
        "name": "Compensation",
        "field": "Compensation",
        "width": 180
      },
      {
        "name": "Job type",
        "field": "Job type",
        "width": 140
      }
    ],
    "identity": {
      "sourceField": "Job URL",
      "normalization": "url"
    },
    "operations": [
      "table.wellfound.jobs"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Job URL",
        "columnName": "Job URL"
      },
      {
        "sourceField": "Job ID",
        "columnName": "Job ID"
      },
      {
        "sourceField": "Title",
        "columnName": "Title"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Company URL",
        "columnName": "Company URL"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      },
      {
        "sourceField": "Remote",
        "columnName": "Remote"
      },
      {
        "sourceField": "Salary",
        "columnName": "Salary"
      },
      {
        "sourceField": "Compensation",
        "columnName": "Compensation"
      },
      {
        "sourceField": "Job type",
        "columnName": "Job type"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "properties-for-sale",
    "category": "Real Estate",
    "name": "Properties for Sale",
    "description": "Search paginated Zillow home listings for sale.",
    "instructions": "Provide a city and state, ZIP code, or neighborhood. The Zillow property ID is used as the stable row identity.",
    "examplePrompts": [
      "Homes for sale in Austin under $500,000",
      "Three-bedroom homes in Sacramento"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "location",
        "label": "City, state, ZIP, or neighborhood",
        "description": "Location passed to Zillow’s search box.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Property ID",
        "field": "Property ID",
        "width": 150
      },
      {
        "name": "Property URL",
        "field": "Property URL",
        "format": "url",
        "width": 250
      },
      {
        "name": "Address",
        "field": "Address",
        "width": 260
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 140
      },
      {
        "name": "Beds",
        "field": "Beds",
        "format": "number",
        "width": 90
      },
      {
        "name": "Baths",
        "field": "Baths",
        "format": "number",
        "width": 90
      },
      {
        "name": "Area",
        "field": "Area",
        "format": "number",
        "width": 110
      },
      {
        "name": "Estimate",
        "field": "Estimate",
        "width": 140
      },
      {
        "name": "Latitude",
        "field": "Latitude",
        "format": "number",
        "width": 110
      },
      {
        "name": "Longitude",
        "field": "Longitude",
        "format": "number",
        "width": 110
      },
      {
        "name": "Listing type",
        "field": "Listing type",
        "width": 120
      }
    ],
    "identity": {
      "sourceField": "Property ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.zillow.sale"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Property ID",
        "columnName": "Property ID"
      },
      {
        "sourceField": "Property URL",
        "columnName": "Property URL"
      },
      {
        "sourceField": "Address",
        "columnName": "Address"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Beds",
        "columnName": "Beds"
      },
      {
        "sourceField": "Baths",
        "columnName": "Baths"
      },
      {
        "sourceField": "Area",
        "columnName": "Area"
      },
      {
        "sourceField": "Estimate",
        "columnName": "Estimate"
      },
      {
        "sourceField": "Latitude",
        "columnName": "Latitude"
      },
      {
        "sourceField": "Longitude",
        "columnName": "Longitude"
      },
      {
        "sourceField": "Listing type",
        "columnName": "Listing type"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "rental-listings",
    "category": "Real Estate",
    "name": "Rental Listings",
    "description": "Search paginated Zillow rental listings.",
    "instructions": "Provide a city and state, ZIP code, or neighborhood. Zillow may return building-level entries and unit-level data. Use the numeric Zillow property ID as row identity.",
    "examplePrompts": [
      "Furnished apartments for rent in Los Angeles",
      "Two-bedroom rentals in ZIP code 10001"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "location",
        "label": "City, state, ZIP, or neighborhood",
        "description": "Location passed to Zillow’s search box.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Property ID",
        "field": "Property ID",
        "width": 150
      },
      {
        "name": "Property URL",
        "field": "Property URL",
        "format": "url",
        "width": 250
      },
      {
        "name": "Address",
        "field": "Address",
        "width": 260
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 140
      },
      {
        "name": "Beds",
        "field": "Beds",
        "format": "number",
        "width": 90
      },
      {
        "name": "Baths",
        "field": "Baths",
        "format": "number",
        "width": 90
      },
      {
        "name": "Area",
        "field": "Area",
        "format": "number",
        "width": 110
      },
      {
        "name": "Availability",
        "field": "Availability",
        "width": 140
      },
      {
        "name": "Building",
        "field": "Building",
        "width": 100
      },
      {
        "name": "Units",
        "field": "Units",
        "width": 180
      },
      {
        "name": "Listing type",
        "field": "Listing type",
        "width": 120
      }
    ],
    "identity": {
      "sourceField": "Property ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.zillow.rent"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Property ID",
        "columnName": "Property ID"
      },
      {
        "sourceField": "Property URL",
        "columnName": "Property URL"
      },
      {
        "sourceField": "Address",
        "columnName": "Address"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Beds",
        "columnName": "Beds"
      },
      {
        "sourceField": "Baths",
        "columnName": "Baths"
      },
      {
        "sourceField": "Area",
        "columnName": "Area"
      },
      {
        "sourceField": "Availability",
        "columnName": "Availability"
      },
      {
        "sourceField": "Building",
        "columnName": "Building"
      },
      {
        "sourceField": "Units",
        "columnName": "Units"
      },
      {
        "sourceField": "Listing type",
        "columnName": "Listing type"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "real-estate-agents",
    "category": "Real Estate",
    "name": "Real Estate Agents",
    "description": "Search agents serving a city and state.",
    "instructions": "Use the specified service location. Each Homes.com agent row uses its returned profile URL as stable identity.",
    "examplePrompts": [
      "Top rated buyer agents in Phoenix, AZ"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "location",
        "label": "City and state",
        "description": "Location passed to the agent search.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Agent URL",
        "field": "Agent URL",
        "format": "url",
        "width": 250
      },
      {
        "name": "Agent ID",
        "field": "Agent ID",
        "width": 160
      },
      {
        "name": "Agent",
        "field": "Agent",
        "width": 220
      },
      {
        "name": "Brokerage",
        "field": "Brokerage",
        "width": 200
      },
      {
        "name": "Rating",
        "field": "Rating",
        "format": "number",
        "width": 90
      },
      {
        "name": "Sales",
        "field": "Sales",
        "format": "number",
        "width": 100
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Agent URL",
      "normalization": "url"
    },
    "operations": [
      "table.homes.agents"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Agent URL",
        "columnName": "Agent URL"
      },
      {
        "sourceField": "Agent ID",
        "columnName": "Agent ID"
      },
      {
        "sourceField": "Agent",
        "columnName": "Agent"
      },
      {
        "sourceField": "Brokerage",
        "columnName": "Brokerage"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Sales",
        "columnName": "Sales"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "venture-funds",
    "category": "Funding & Venture",
    "name": "Venture Funds",
    "description": "Find currently deploying funds by stage, country, and investment focus.",
    "instructions": "Use stage, country, and industry filters where known. The response is paginated and includes fund slugs and profile URLs. Upstream limits this Monid credential to 150 fund results per UTC day.",
    "examplePrompts": [
      "Pre-seed climate-tech funds investing in Germany",
      "Series A SaaS funds in the United States"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "stage",
        "label": "Funding stage",
        "description": "Optional stage filter.",
        "type": "select",
        "options": [
          {
            "label": "Pre-seed",
            "value": "pre_seed"
          },
          {
            "label": "Seed",
            "value": "seed"
          },
          {
            "label": "Series A",
            "value": "series_a"
          },
          {
            "label": "Series B",
            "value": "series_b"
          },
          {
            "label": "Series C",
            "value": "series_c"
          },
          {
            "label": "Late stage",
            "value": "late_stage"
          },
          {
            "label": "Growth",
            "value": "growth"
          }
        ],
        "required": false
      },
      {
        "key": "country",
        "label": "Country",
        "description": "Optional full country name.",
        "type": "text",
        "required": false
      },
      {
        "key": "industry",
        "label": "Industry slug",
        "description": "Optional Fund Momentum industry slug, for example saas or fintech.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Fund URL",
        "field": "Fund URL",
        "format": "url",
        "width": 240
      },
      {
        "name": "Fund",
        "field": "Fund",
        "width": 230
      },
      {
        "name": "Country",
        "field": "Country",
        "width": 150
      },
      {
        "name": "Stages",
        "field": "Stages",
        "width": 180
      },
      {
        "name": "Fund size",
        "field": "Fund size",
        "width": 140
      },
      {
        "name": "Website",
        "field": "Website",
        "format": "url",
        "width": 220
      },
      {
        "name": "Last close date",
        "field": "Last close date",
        "width": 150
      },
      {
        "name": "Last close type",
        "field": "Last close type",
        "width": 150
      },
      {
        "name": "Industries",
        "field": "Industries",
        "width": 250
      }
    ],
    "identity": {
      "sourceField": "Fund URL",
      "normalization": "url"
    },
    "operations": [
      "table.fundmomentum.funds"
    ],
    "pagination": {
      "strategy": "offset",
      "maxCalls": 3
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Fund URL",
        "columnName": "Fund URL"
      },
      {
        "sourceField": "Fund",
        "columnName": "Fund"
      },
      {
        "sourceField": "Country",
        "columnName": "Country"
      },
      {
        "sourceField": "Stages",
        "columnName": "Stages"
      },
      {
        "sourceField": "Fund size",
        "columnName": "Fund size"
      },
      {
        "sourceField": "Website",
        "columnName": "Website"
      },
      {
        "sourceField": "Last close date",
        "columnName": "Last close date"
      },
      {
        "sourceField": "Last close type",
        "columnName": "Last close type"
      },
      {
        "sourceField": "Industries",
        "columnName": "Industries"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "funding-rounds",
    "category": "Funding & Venture",
    "name": "Funding Rounds",
    "description": "Search venture funding rounds by round, date, size, and company description.",
    "instructions": "Use the user description for company and geography context. Apply the selected round type and optional date and minimum-size filters. Calls are capped at 50 returned deals ($3 maximum per search).",
    "examplePrompts": [
      "Seed rounds announced this month by US climate software startups",
      "Series A rounds over $10 million in Europe"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "round-type",
        "label": "Round type",
        "description": "Required Fundable financing type.",
        "type": "select",
        "options": [
          {
            "label": "Pre-seed",
            "value": "pre_seed"
          },
          {
            "label": "Seed",
            "value": "seed"
          },
          {
            "label": "Series A",
            "value": "series_a"
          },
          {
            "label": "Series B",
            "value": "series_b"
          },
          {
            "label": "Series C",
            "value": "series_c"
          }
        ],
        "required": true
      },
      {
        "key": "date-start",
        "label": "Start date",
        "description": "Optional ISO date, YYYY-MM-DD.",
        "type": "text",
        "required": false
      },
      {
        "key": "date-end",
        "label": "End date",
        "description": "Optional ISO date, YYYY-MM-DD.",
        "type": "text",
        "required": false
      },
      {
        "key": "min-size",
        "label": "Minimum round size",
        "description": "Optional minimum amount in USD.",
        "type": "text",
        "required": false
      },
      {
        "key": "location-permalink",
        "label": "Company location permalink",
        "description": "Optional exact Fundable location permalink, not a display name.",
        "type": "text",
        "required": false
      },
      {
        "key": "industry-permalink",
        "label": "Company industry permalink",
        "description": "Optional exact Fundable industry permalink, not a display name.",
        "type": "text",
        "required": false
      },
      {
        "key": "employee-count",
        "label": "Company employee range",
        "description": "Optional Fundable company headcount filter.",
        "type": "select",
        "options": [
          {
            "label": "1–10",
            "value": "1-10"
          },
          {
            "label": "11–50",
            "value": "11-50"
          },
          {
            "label": "51–100",
            "value": "51-100"
          },
          {
            "label": "101–250",
            "value": "101-250"
          },
          {
            "label": "251–500",
            "value": "251-500"
          },
          {
            "label": "501–1,000",
            "value": "501-1000"
          },
          {
            "label": "1,001–5,000",
            "value": "1001-5000"
          },
          {
            "label": "5,001–10,000",
            "value": "5001-10000"
          },
          {
            "label": "10,001+",
            "value": "10001+"
          }
        ],
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Deal ID",
        "field": "Deal ID",
        "width": 150
      },
      {
        "name": "Company ID",
        "field": "Company ID",
        "width": 150
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 220
      },
      {
        "name": "Round",
        "field": "Round",
        "width": 120
      },
      {
        "name": "Date",
        "field": "Date",
        "width": 140
      },
      {
        "name": "Amount",
        "field": "Amount",
        "width": 140
      },
      {
        "name": "Valuation",
        "field": "Valuation",
        "width": 140
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 320
      },
      {
        "name": "Investors",
        "field": "Investors",
        "width": 240
      },
      {
        "name": "Source URLs",
        "field": "Source URLs",
        "width": 240
      }
    ],
    "identity": {
      "sourceField": "Deal ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.fundable.deals"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Deal ID",
        "columnName": "Deal ID"
      },
      {
        "sourceField": "Company ID",
        "columnName": "Company ID"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Round",
        "columnName": "Round"
      },
      {
        "sourceField": "Date",
        "columnName": "Date"
      },
      {
        "sourceField": "Amount",
        "columnName": "Amount"
      },
      {
        "sourceField": "Valuation",
        "columnName": "Valuation"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Investors",
        "columnName": "Investors"
      },
      {
        "sourceField": "Source URLs",
        "columnName": "Source URLs"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "mobile-app-search",
    "category": "Products & Shopping",
    "name": "Mobile App Search",
    "description": "Search the Apple App Store or Google Play.",
    "instructions": "Search the selected app store for the described mobile app. Keep the store app ID and listing URL.",
    "examplePrompts": [
      "Project management apps for small teams",
      "Fitness tracking apps with offline support"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "storefront",
        "label": "App store",
        "description": "Choose exactly one catalog.",
        "type": "select",
        "options": [
          {
            "label": "Apple App Store",
            "value": "apple"
          },
          {
            "label": "Google Play",
            "value": "google"
          }
        ],
        "required": true
      },
      {
        "key": "country",
        "label": "Country storefront",
        "description": "Optional two-letter store country code, such as us.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "App ID",
        "field": "App ID",
        "width": 180
      },
      {
        "name": "App",
        "field": "App",
        "width": 180
      },
      {
        "name": "Store",
        "field": "Store",
        "width": 180
      },
      {
        "name": "Developer",
        "field": "Developer",
        "width": 180
      },
      {
        "name": "Category",
        "field": "Category",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "width": 180
      },
      {
        "name": "Rating count",
        "field": "Rating count",
        "width": 180
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 180
      },
      {
        "name": "Icon",
        "field": "Icon",
        "format": "url",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "App URL",
        "field": "App URL",
        "format": "url",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "App ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.googleplay.search",
      "table.appstore.search"
    ],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "App ID",
        "columnName": "App ID"
      },
      {
        "sourceField": "App",
        "columnName": "App"
      },
      {
        "sourceField": "Store",
        "columnName": "Store"
      },
      {
        "sourceField": "Developer",
        "columnName": "Developer"
      },
      {
        "sourceField": "Category",
        "columnName": "Category"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Rating count",
        "columnName": "Rating count"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Icon",
        "columnName": "Icon"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "App URL",
        "columnName": "App URL"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "mobile-app-reviews",
    "category": "Reviews & Reputation",
    "name": "Mobile App Reviews",
    "description": "Resolve or select a mobile app and page through its store reviews.",
    "instructions": "Choose an app store and provide an App ID to skip lookup. Otherwise the search phrase is resolved through the selected store. Review identity is a deterministic hash of app, reviewer, date and text because the inspected schemas expose no provider review ID.",
    "examplePrompts": [
      "Recent reviews for the Calm app on iOS",
      "Google Play reviews for com.example.app"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "storefront",
        "label": "App store",
        "description": "Choose exactly one review source.",
        "type": "select",
        "options": [
          {
            "label": "Apple App Store",
            "value": "apple"
          },
          {
            "label": "Google Play",
            "value": "google"
          }
        ],
        "required": true
      },
      {
        "key": "app-id",
        "label": "App ID",
        "description": "Optional store identifier\u003b if blank, Monid searches by app name.",
        "type": "text",
        "required": false
      },
      {
        "key": "country",
        "label": "Country storefront",
        "description": "Optional two-letter storefront code, such as us.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Review key",
        "field": "Review key",
        "width": 180
      },
      {
        "name": "App ID",
        "field": "App ID",
        "width": 180
      },
      {
        "name": "Store",
        "field": "Store",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "width": 180
      },
      {
        "name": "Title",
        "field": "Title",
        "width": 180
      },
      {
        "name": "Review",
        "field": "Review",
        "width": 180
      },
      {
        "name": "Date",
        "field": "Date",
        "width": 180
      },
      {
        "name": "Reviewer",
        "field": "Reviewer",
        "width": 180
      },
      {
        "name": "App version",
        "field": "App version",
        "width": 180
      },
      {
        "name": "Helpful votes",
        "field": "Helpful votes",
        "width": 180
      },
      {
        "name": "Developer reply",
        "field": "Developer reply",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Review key",
      "normalization": "text"
    },
    "operations": [
      "table.googleplay.search",
      "table.appstore.search",
      "table.googleplay.reviews",
      "table.appstore.reviews"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "chaining": {
      "enabled": true,
      "operations": [
        "table.googleplay.search",
        "table.appstore.search"
      ]
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Review key",
        "columnName": "Review key"
      },
      {
        "sourceField": "App ID",
        "columnName": "App ID"
      },
      {
        "sourceField": "Store",
        "columnName": "Store"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Title",
        "columnName": "Title"
      },
      {
        "sourceField": "Review",
        "columnName": "Review"
      },
      {
        "sourceField": "Date",
        "columnName": "Date"
      },
      {
        "sourceField": "Reviewer",
        "columnName": "Reviewer"
      },
      {
        "sourceField": "App version",
        "columnName": "App version"
      },
      {
        "sourceField": "Helpful votes",
        "columnName": "Helpful votes"
      },
      {
        "sourceField": "Developer reply",
        "columnName": "Developer reply"
      }
    ]
  },
  {
    "id": "employer-career-jobs",
    "category": "Jobs & Careers",
    "name": "Employer Career Listings",
    "description": "Page through an employer’s Greenhouse or Lever job board.",
    "instructions": "Choose the employer board vendor and enter its public board identifier. Each returned job is one row\u003b search terms are passed to Greenhouse when supported, and the returned board jobs are available from Lever.",
    "examplePrompts": [
      "Open roles at the Acme Greenhouse board",
      "Remote engineering jobs on the example Lever board"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "ats",
        "label": "Board provider",
        "description": "Select the employer ATS board.",
        "type": "select",
        "options": [
          {
            "label": "Greenhouse",
            "value": "greenhouse"
          },
          {
            "label": "Lever",
            "value": "lever"
          }
        ],
        "required": true
      },
      {
        "key": "board",
        "label": "Board identifier",
        "description": "Greenhouse board token or Lever company slug.",
        "type": "text",
        "required": true
      },
      {
        "key": "location",
        "label": "Location",
        "description": "Optional location filter.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Job ID",
        "field": "Job ID",
        "width": 180
      },
      {
        "name": "Title",
        "field": "Title",
        "width": 180
      },
      {
        "name": "Job URL",
        "field": "Job URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 180
      },
      {
        "name": "Company board",
        "field": "Company board",
        "width": 180
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 180
      },
      {
        "name": "Department",
        "field": "Department",
        "width": 180
      },
      {
        "name": "Team",
        "field": "Team",
        "width": 180
      },
      {
        "name": "Workplace type",
        "field": "Workplace type",
        "width": 180
      },
      {
        "name": "Job type",
        "field": "Job type",
        "width": 180
      },
      {
        "name": "Salary",
        "field": "Salary",
        "width": 180
      },
      {
        "name": "First published",
        "field": "First published",
        "width": 180
      },
      {
        "name": "Updated",
        "field": "Updated",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Job ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.greenhouse.jobs",
      "table.lever.jobs"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Job ID",
        "columnName": "Job ID"
      },
      {
        "sourceField": "Title",
        "columnName": "Title"
      },
      {
        "sourceField": "Job URL",
        "columnName": "Job URL"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Company board",
        "columnName": "Company board"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      },
      {
        "sourceField": "Department",
        "columnName": "Department"
      },
      {
        "sourceField": "Team",
        "columnName": "Team"
      },
      {
        "sourceField": "Workplace type",
        "columnName": "Workplace type"
      },
      {
        "sourceField": "Job type",
        "columnName": "Job type"
      },
      {
        "sourceField": "Salary",
        "columnName": "Salary"
      },
      {
        "sourceField": "First published",
        "columnName": "First published"
      },
      {
        "sourceField": "Updated",
        "columnName": "Updated"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "funded-companies",
    "category": "Companies & Organizations",
    "name": "Funded Companies",
    "description": "Find funded companies by industry, stage, and funding context.",
    "instructions": "Use the full prompt as Fundable’s semantic company query. Results are limited to 50 ($3 maximum per search) and the upstream semantic endpoint has a monthly quota.",
    "examplePrompts": [
      "Recently funded climate software startups in the United States",
      "Series B health technology companies in Europe"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Company ID",
        "field": "Company ID",
        "width": 180
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 180
      },
      {
        "name": "Domain",
        "field": "Domain",
        "format": "url",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "Headcount",
        "field": "Headcount",
        "width": 180
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 180
      },
      {
        "name": "Industries",
        "field": "Industries",
        "width": 180
      },
      {
        "name": "Total raised",
        "field": "Total raised",
        "width": 180
      },
      {
        "name": "Latest valuation",
        "field": "Latest valuation",
        "width": 180
      },
      {
        "name": "Latest round",
        "field": "Latest round",
        "width": 180
      },
      {
        "name": "Latest round date",
        "field": "Latest round date",
        "width": 180
      },
      {
        "name": "Investors",
        "field": "Investors",
        "width": 180
      },
      {
        "name": "Source URLs",
        "field": "Source URLs",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Company ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.fundable.companies"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Company ID",
        "columnName": "Company ID"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Domain",
        "columnName": "Domain"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Headcount",
        "columnName": "Headcount"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      },
      {
        "sourceField": "Industries",
        "columnName": "Industries"
      },
      {
        "sourceField": "Total raised",
        "columnName": "Total raised"
      },
      {
        "sourceField": "Latest valuation",
        "columnName": "Latest valuation"
      },
      {
        "sourceField": "Latest round",
        "columnName": "Latest round"
      },
      {
        "sourceField": "Latest round date",
        "columnName": "Latest round date"
      },
      {
        "sourceField": "Investors",
        "columnName": "Investors"
      },
      {
        "sourceField": "Source URLs",
        "columnName": "Source URLs"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "venture-investors",
    "category": "Funding & Venture",
    "name": "Venture Investors",
    "description": "Find investors by investment focus, stage, location, and portfolio themes.",
    "instructions": "Use the prompt as Fundable’s portfolio/investment semantic search. Results are capped at 50 ($3 maximum per search)\u003b the upstream semantic endpoint has a monthly quota.",
    "examplePrompts": [
      "Seed investors focused on climate software",
      "US venture firms investing in B2B SaaS"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Investor ID",
        "field": "Investor ID",
        "width": 180
      },
      {
        "name": "Investor",
        "field": "Investor",
        "width": 180
      },
      {
        "name": "Domain",
        "field": "Domain",
        "width": 180
      },
      {
        "name": "Website",
        "field": "Website",
        "format": "url",
        "width": 180
      },
      {
        "name": "LinkedIn",
        "field": "LinkedIn",
        "format": "url",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "Stage",
        "field": "Stage",
        "width": 180
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 180
      },
      {
        "name": "Total deals",
        "field": "Total deals",
        "width": 180
      },
      {
        "name": "Lead deals",
        "field": "Lead deals",
        "width": 180
      },
      {
        "name": "Recent deal date",
        "field": "Recent deal date",
        "width": 180
      },
      {
        "name": "Industries",
        "field": "Industries",
        "width": 180
      },
      {
        "name": "Top locations",
        "field": "Top locations",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Investor ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.fundable.investors"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Investor ID",
        "columnName": "Investor ID"
      },
      {
        "sourceField": "Investor",
        "columnName": "Investor"
      },
      {
        "sourceField": "Domain",
        "columnName": "Domain"
      },
      {
        "sourceField": "Website",
        "columnName": "Website"
      },
      {
        "sourceField": "LinkedIn",
        "columnName": "LinkedIn"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Stage",
        "columnName": "Stage"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      },
      {
        "sourceField": "Total deals",
        "columnName": "Total deals"
      },
      {
        "sourceField": "Lead deals",
        "columnName": "Lead deals"
      },
      {
        "sourceField": "Recent deal date",
        "columnName": "Recent deal date"
      },
      {
        "sourceField": "Industries",
        "columnName": "Industries"
      },
      {
        "sourceField": "Top locations",
        "columnName": "Top locations"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "investor-deals",
    "category": "Funding & Venture",
    "name": "Investor Portfolio Deals",
    "description": "List deals associated with an investor’s domain.",
    "instructions": "Provide the investor domain to fetch its portfolio deals. The prompt is retained for sheet context\u003b Monid returns up to 50 deals per run.",
    "examplePrompts": [
      "Show deals for a16z.com",
      "Portfolio companies for investor example.com"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "investor-domain",
        "label": "Investor domain",
        "description": "Required investor website domain, without a URL scheme.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Deal ID",
        "field": "Deal ID",
        "width": 180
      },
      {
        "name": "Company ID",
        "field": "Company ID",
        "width": 180
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 180
      },
      {
        "name": "Round",
        "field": "Round",
        "width": 180
      },
      {
        "name": "Date",
        "field": "Date",
        "width": 180
      },
      {
        "name": "Amount",
        "field": "Amount",
        "width": 180
      },
      {
        "name": "Valuation",
        "field": "Valuation",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "Investors",
        "field": "Investors",
        "width": 180
      },
      {
        "name": "Source URLs",
        "field": "Source URLs",
        "format": "url",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Deal ID",
      "normalization": "provider-id"
    },
    "operations": [
      "table.fundable.investor-deals"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Deal ID",
        "columnName": "Deal ID"
      },
      {
        "sourceField": "Company ID",
        "columnName": "Company ID"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Round",
        "columnName": "Round"
      },
      {
        "sourceField": "Date",
        "columnName": "Date"
      },
      {
        "sourceField": "Amount",
        "columnName": "Amount"
      },
      {
        "sourceField": "Valuation",
        "columnName": "Valuation"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Investors",
        "columnName": "Investors"
      },
      {
        "sourceField": "Source URLs",
        "columnName": "Source URLs"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "suppliers-manufacturers",
    "category": "Companies & Organizations",
    "name": "Manufacturers & Industrial Suppliers",
    "description": "Find North American manufacturers and industrial suppliers by product or service.",
    "instructions": "Use the description as the ThomasNet keyword. Results are North American directory listings\u003b the endpoint accepts directory scopes rather than cities or country codes, so do not promise city-level filtering. Keep the returned profile URL and provider ID.",
    "examplePrompts": [
      "Injection molding manufacturers",
      "Industrial suppliers for stainless steel fasteners"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Manufacturer key",
        "field": "Manufacturer key",
        "width": 180
      },
      {
        "name": "Manufacturer ID",
        "field": "Manufacturer ID",
        "width": 180
      },
      {
        "name": "Manufacturer",
        "field": "Manufacturer",
        "width": 180
      },
      {
        "name": "Profile URL",
        "field": "Profile URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "Address",
        "field": "Address",
        "width": 180
      },
      {
        "name": "Email",
        "field": "Email",
        "width": 180
      },
      {
        "name": "Phone",
        "field": "Phone",
        "width": 180
      },
      {
        "name": "Annual sales",
        "field": "Annual sales",
        "width": 180
      },
      {
        "name": "Employees",
        "field": "Employees",
        "width": 180
      },
      {
        "name": "Brands",
        "field": "Brands",
        "width": 180
      },
      {
        "name": "Categories",
        "field": "Categories",
        "width": 180
      },
      {
        "name": "Location types",
        "field": "Location types",
        "width": 180
      },
      {
        "name": "Claimed",
        "field": "Claimed",
        "width": 180
      },
      {
        "name": "Multi-location",
        "field": "Multi-location",
        "width": 180
      },
      {
        "name": "Image",
        "field": "Image",
        "format": "url",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Manufacturer key",
      "normalization": "text"
    },
    "operations": [
      "table.thomasnet.search"
    ],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Manufacturer key",
        "columnName": "Manufacturer key"
      },
      {
        "sourceField": "Manufacturer ID",
        "columnName": "Manufacturer ID"
      },
      {
        "sourceField": "Manufacturer",
        "columnName": "Manufacturer"
      },
      {
        "sourceField": "Profile URL",
        "columnName": "Profile URL"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Address",
        "columnName": "Address"
      },
      {
        "sourceField": "Email",
        "columnName": "Email"
      },
      {
        "sourceField": "Phone",
        "columnName": "Phone"
      },
      {
        "sourceField": "Annual sales",
        "columnName": "Annual sales"
      },
      {
        "sourceField": "Employees",
        "columnName": "Employees"
      },
      {
        "sourceField": "Brands",
        "columnName": "Brands"
      },
      {
        "sourceField": "Categories",
        "columnName": "Categories"
      },
      {
        "sourceField": "Location types",
        "columnName": "Location types"
      },
      {
        "sourceField": "Claimed",
        "columnName": "Claimed"
      },
      {
        "sourceField": "Multi-location",
        "columnName": "Multi-location"
      },
      {
        "sourceField": "Image",
        "columnName": "Image"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "creator-influencers",
    "category": "People",
    "name": "TikTok Creator Search",
    "description": "Find TikTok accounts ranked by the platform search for a topic or keyword.",
    "instructions": "Use the prompt as a TikTok account keyword. The provider returns only one page of up to 20 accounts. Search keyword results may not be direct topic matches\u003b verify each bio and profile manually, and do not treat follower or engagement counts as evidence of reach or sales.",
    "examplePrompts": [
      "TikTok creators who review home coffee gear",
      "TikTok accounts about independent bookstores"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Creator URL",
        "field": "Creator URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "TikTok user ID",
        "field": "TikTok user ID",
        "width": 180
      },
      {
        "name": "Handle",
        "field": "Handle",
        "width": 180
      },
      {
        "name": "Creator",
        "field": "Creator",
        "width": 180
      },
      {
        "name": "Bio",
        "field": "Bio",
        "width": 180
      },
      {
        "name": "Region",
        "field": "Region",
        "width": 180
      },
      {
        "name": "Followers",
        "field": "Followers",
        "width": 180
      },
      {
        "name": "Following",
        "field": "Following",
        "width": 180
      },
      {
        "name": "Likes",
        "field": "Likes",
        "width": 180
      },
      {
        "name": "Videos",
        "field": "Videos",
        "width": 180
      },
      {
        "name": "Verified",
        "field": "Verified",
        "width": 180
      },
      {
        "name": "Avatar",
        "field": "Avatar",
        "format": "url",
        "width": 180
      },
      {
        "name": "Instagram",
        "field": "Instagram",
        "format": "url",
        "width": 180
      },
      {
        "name": "YouTube",
        "field": "YouTube",
        "format": "url",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Creator URL",
      "normalization": "url"
    },
    "operations": [
      "table.tiktok.search"
    ],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Creator URL",
        "columnName": "Creator URL"
      },
      {
        "sourceField": "TikTok user ID",
        "columnName": "TikTok user ID"
      },
      {
        "sourceField": "Handle",
        "columnName": "Handle"
      },
      {
        "sourceField": "Creator",
        "columnName": "Creator"
      },
      {
        "sourceField": "Bio",
        "columnName": "Bio"
      },
      {
        "sourceField": "Region",
        "columnName": "Region"
      },
      {
        "sourceField": "Followers",
        "columnName": "Followers"
      },
      {
        "sourceField": "Following",
        "columnName": "Following"
      },
      {
        "sourceField": "Likes",
        "columnName": "Likes"
      },
      {
        "sourceField": "Videos",
        "columnName": "Videos"
      },
      {
        "sourceField": "Verified",
        "columnName": "Verified"
      },
      {
        "sourceField": "Avatar",
        "columnName": "Avatar"
      },
      {
        "sourceField": "Instagram",
        "columnName": "Instagram"
      },
      {
        "sourceField": "YouTube",
        "columnName": "YouTube"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "software-reviews",
    "category": "Reviews & Reputation",
    "name": "Software Reviews",
    "description": "Find reviews for one software product on G2 or Capterra.",
    "instructions": "Choose G2 or Capterra. Resolve the prompt to the first matching product returned by that provider unless the user supplies its exact identifiers. G2 accepts a product slug\u003b Capterra requires a numeric product ID and product name to skip lookup. Preserve the resolved product name, slug, and returned URL beside each review. Review identity is a deterministic hash of provider, product, reviewer, date, title, and review text.",
    "examplePrompts": [
      "Recent HubSpot CRM reviews on G2",
      "Capterra reviews for Asana"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "source",
        "label": "Review source",
        "description": "Choose one product-review catalog.",
        "type": "select",
        "options": [
          {
            "label": "G2",
            "value": "g2"
          },
          {
            "label": "Capterra",
            "value": "capterra"
          }
        ],
        "required": true
      },
      {
        "key": "product-slug",
        "label": "Product slug",
        "description": "Optional exact G2 product slug\u003b otherwise Monid searches the prompt.",
        "type": "text",
        "required": false
      },
      {
        "key": "product-id",
        "label": "Product ID",
        "description": "Optional exact Capterra numeric product ID.",
        "type": "text",
        "required": false
      },
      {
        "key": "product-name",
        "label": "Product name",
        "description": "Optional exact Capterra product name\u003b required with its product ID to skip lookup.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Review key",
        "field": "Review key",
        "width": 180
      },
      {
        "name": "Provider",
        "field": "Provider",
        "width": 180
      },
      {
        "name": "Product",
        "field": "Product",
        "width": 180
      },
      {
        "name": "Product ID",
        "field": "Product ID",
        "width": 180
      },
      {
        "name": "Product slug",
        "field": "Product slug",
        "width": 180
      },
      {
        "name": "Product URL",
        "field": "Product URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "width": 180
      },
      {
        "name": "Title",
        "field": "Title",
        "width": 180
      },
      {
        "name": "Review",
        "field": "Review",
        "width": 180
      },
      {
        "name": "Pros",
        "field": "Pros",
        "width": 180
      },
      {
        "name": "Cons",
        "field": "Cons",
        "width": 180
      },
      {
        "name": "Date",
        "field": "Date",
        "width": 180
      },
      {
        "name": "Reviewer",
        "field": "Reviewer",
        "width": 180
      },
      {
        "name": "Role",
        "field": "Role",
        "width": 180
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 180
      },
      {
        "name": "Location",
        "field": "Location",
        "width": 180
      },
      {
        "name": "Industry",
        "field": "Industry",
        "width": 180
      },
      {
        "name": "Employee range",
        "field": "Employee range",
        "width": 180
      },
      {
        "name": "Likes",
        "field": "Likes",
        "width": 180
      },
      {
        "name": "Dislikes",
        "field": "Dislikes",
        "width": 180
      },
      {
        "name": "Problems solved",
        "field": "Problems solved",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Review key",
      "normalization": "text"
    },
    "operations": [
      "table.g2.search-software",
      "table.g2.reviews",
      "table.capterra.search-software",
      "table.capterra.reviews"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 20
    },
    "chaining": {
      "enabled": true,
      "operations": [
        "table.g2.reviews",
        "table.capterra.reviews"
      ]
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Review key",
        "columnName": "Review key"
      },
      {
        "sourceField": "Provider",
        "columnName": "Provider"
      },
      {
        "sourceField": "Product",
        "columnName": "Product"
      },
      {
        "sourceField": "Product ID",
        "columnName": "Product ID"
      },
      {
        "sourceField": "Product slug",
        "columnName": "Product slug"
      },
      {
        "sourceField": "Product URL",
        "columnName": "Product URL"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Title",
        "columnName": "Title"
      },
      {
        "sourceField": "Review",
        "columnName": "Review"
      },
      {
        "sourceField": "Pros",
        "columnName": "Pros"
      },
      {
        "sourceField": "Cons",
        "columnName": "Cons"
      },
      {
        "sourceField": "Date",
        "columnName": "Date"
      },
      {
        "sourceField": "Reviewer",
        "columnName": "Reviewer"
      },
      {
        "sourceField": "Role",
        "columnName": "Role"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Location",
        "columnName": "Location"
      },
      {
        "sourceField": "Industry",
        "columnName": "Industry"
      },
      {
        "sourceField": "Employee range",
        "columnName": "Employee range"
      },
      {
        "sourceField": "Likes",
        "columnName": "Likes"
      },
      {
        "sourceField": "Dislikes",
        "columnName": "Dislikes"
      },
      {
        "sourceField": "Problems solved",
        "columnName": "Problems solved"
      }
    ]
  },
  {
    "id": "import-export-companies",
    "category": "Trade & Supply Chain",
    "name": "Importers & Exporters",
    "description": "Rank companies by matching trade activity.",
    "instructions": "Choose whether the trade data represents imports or exports and provide a product description, required date window, and optional HS code/countries. Tendata returns company names and aggregate activity\u003b results may include freight forwarders unless manually screened.",
    "examplePrompts": [
      "Companies importing solar panels into the US from China",
      "Exporters of coffee beans from Brazil"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "trade-direction",
        "label": "Trade direction",
        "description": "Choose the Tendata customs-data side.",
        "type": "select",
        "options": [
          {
            "label": "Importers",
            "value": "imports"
          },
          {
            "label": "Exporters",
            "value": "exports"
          }
        ],
        "required": true
      },
      {
        "key": "date-start",
        "label": "Start date",
        "description": "Required YYYY-MM-DD date\u003b date window may not exceed three years.",
        "type": "text",
        "required": true
      },
      {
        "key": "date-end",
        "label": "End date",
        "description": "Required YYYY-MM-DD date\u003b must be after the start date.",
        "type": "text",
        "required": true
      },
      {
        "key": "hs-code",
        "label": "HS code",
        "description": "Optional 2+ digit customs code.",
        "type": "text",
        "required": false
      },
      {
        "key": "country-origin",
        "label": "Origin country ISO3",
        "description": "Optional ISO3 code(s), separated by semicolons.",
        "type": "text",
        "required": false
      },
      {
        "key": "country-destination",
        "label": "Destination country ISO3",
        "description": "Optional ISO3 code(s), separated by semicolons.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "Company key",
        "field": "Company key",
        "width": 180
      },
      {
        "name": "Company",
        "field": "Company",
        "width": 180
      },
      {
        "name": "Trade role",
        "field": "Trade role",
        "width": 180
      },
      {
        "name": "Country",
        "field": "Country",
        "width": 180
      },
      {
        "name": "Total weight",
        "field": "Total weight",
        "width": 180
      },
      {
        "name": "Quantity",
        "field": "Quantity",
        "width": 180
      },
      {
        "name": "USD value",
        "field": "USD value",
        "width": 180
      },
      {
        "name": "Average price per kg",
        "field": "Average price per kg",
        "width": 180
      },
      {
        "name": "Average price per unit",
        "field": "Average price per unit",
        "width": 180
      },
      {
        "name": "Trade count",
        "field": "Trade count",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Company key",
      "normalization": "text"
    },
    "operations": [
      "table.tendata.importers",
      "table.tendata.exporters"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 10
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Company key",
        "columnName": "Company key"
      },
      {
        "sourceField": "Company",
        "columnName": "Company"
      },
      {
        "sourceField": "Trade role",
        "columnName": "Trade role"
      },
      {
        "sourceField": "Country",
        "columnName": "Country"
      },
      {
        "sourceField": "Total weight",
        "columnName": "Total weight"
      },
      {
        "sourceField": "Quantity",
        "columnName": "Quantity"
      },
      {
        "sourceField": "USD value",
        "columnName": "USD value"
      },
      {
        "sourceField": "Average price per kg",
        "columnName": "Average price per kg"
      },
      {
        "sourceField": "Average price per unit",
        "columnName": "Average price per unit"
      },
      {
        "sourceField": "Trade count",
        "columnName": "Trade count"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "hs-code-activity",
    "category": "Trade & Supply Chain",
    "name": "Trade HS Code Activity",
    "description": "Resolve product descriptions to HS codes and aggregate trade activity.",
    "instructions": "Use the prompt as the product description, select imports or exports, and provide the required date window. Each row is a customs HS code with aggregate value and volume. Trade count counts declaration goods lines rather than distinct shipments.",
    "examplePrompts": [
      "HS codes for solar panels imported to the US",
      "Trade codes for roasted coffee exports from Brazil"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "trade-direction",
        "label": "Trade direction",
        "description": "Choose imports or exports.",
        "type": "select",
        "options": [
          {
            "label": "Imports",
            "value": "imports"
          },
          {
            "label": "Exports",
            "value": "exports"
          }
        ],
        "required": true
      },
      {
        "key": "date-start",
        "label": "Start date",
        "description": "Required YYYY-MM-DD date\u003b date window may not exceed three years.",
        "type": "text",
        "required": true
      },
      {
        "key": "date-end",
        "label": "End date",
        "description": "Required YYYY-MM-DD date\u003b must be after the start date.",
        "type": "text",
        "required": true
      },
      {
        "key": "country-origin",
        "label": "Origin country ISO3",
        "description": "Optional ISO3 code(s), separated by semicolons.",
        "type": "text",
        "required": false
      },
      {
        "key": "country-destination",
        "label": "Destination country ISO3",
        "description": "Optional ISO3 code(s), separated by semicolons.",
        "type": "text",
        "required": false
      }
    ],
    "defaultColumns": [
      {
        "name": "HS code",
        "field": "HS code",
        "width": 180
      },
      {
        "name": "Description",
        "field": "Description",
        "width": 180
      },
      {
        "name": "Chinese description",
        "field": "Chinese description",
        "width": 180
      },
      {
        "name": "Weight",
        "field": "Weight",
        "width": 180
      },
      {
        "name": "Quantity",
        "field": "Quantity",
        "width": 180
      },
      {
        "name": "USD value",
        "field": "USD value",
        "width": 180
      },
      {
        "name": "Average price per kg",
        "field": "Average price per kg",
        "width": 180
      },
      {
        "name": "Average price per unit",
        "field": "Average price per unit",
        "width": 180
      },
      {
        "name": "Trade count",
        "field": "Trade count",
        "width": 180
      },
      {
        "name": "Value share",
        "field": "Value share",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "HS code",
      "normalization": "text"
    },
    "operations": [
      "table.tendata.hs-code"
    ],
    "pagination": {
      "strategy": "page",
      "maxCalls": 10
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "HS code",
        "columnName": "HS code"
      },
      {
        "sourceField": "Description",
        "columnName": "Description"
      },
      {
        "sourceField": "Chinese description",
        "columnName": "Chinese description"
      },
      {
        "sourceField": "Weight",
        "columnName": "Weight"
      },
      {
        "sourceField": "Quantity",
        "columnName": "Quantity"
      },
      {
        "sourceField": "USD value",
        "columnName": "USD value"
      },
      {
        "sourceField": "Average price per kg",
        "columnName": "Average price per kg"
      },
      {
        "sourceField": "Average price per unit",
        "columnName": "Average price per unit"
      },
      {
        "sourceField": "Trade count",
        "columnName": "Trade count"
      },
      {
        "sourceField": "Value share",
        "columnName": "Value share"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "amazon-product-search",
    "category": "Products & Shopping",
    "name": "Amazon Product Search",
    "description": "Search Amazon US for ranked products, prices, ratings, and availability signals.",
    "instructions": "Use the prompt as the Amazon keyword. The first-party search returns a bounded set of ranked US listings\u003b retain ASIN as identity and the product URL for follow-on seller-offer lookup.",
    "examplePrompts": [
      "USB-C docking stations under $150",
      "Compact espresso machines with strong customer ratings"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "marketplace",
        "label": "Amazon marketplace",
        "description": "Currently verified marketplace.",
        "type": "select",
        "options": [
          {
            "label": "United States",
            "value": "us"
          }
        ],
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "ASIN",
        "field": "ASIN",
        "width": 180
      },
      {
        "name": "Product",
        "field": "Product",
        "width": 180
      },
      {
        "name": "Product URL",
        "field": "Product URL",
        "format": "url",
        "width": 180
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 180
      },
      {
        "name": "Currency",
        "field": "Currency",
        "width": 180
      },
      {
        "name": "Rating",
        "field": "Rating",
        "width": 180
      },
      {
        "name": "Review count",
        "field": "Review count",
        "width": 180
      },
      {
        "name": "Rank",
        "field": "Rank",
        "width": 180
      },
      {
        "name": "Prime",
        "field": "Prime",
        "width": 180
      },
      {
        "name": "Sponsored",
        "field": "Sponsored",
        "width": 180
      },
      {
        "name": "Best seller",
        "field": "Best seller",
        "width": 180
      },
      {
        "name": "Amazon choice",
        "field": "Amazon choice",
        "width": 180
      },
      {
        "name": "Image",
        "field": "Image",
        "format": "url",
        "width": 180
      },
      {
        "name": "Delivery",
        "field": "Delivery",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "ASIN",
      "normalization": "provider-id"
    },
    "operations": [
      "table.amazon.products"
    ],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "ASIN",
        "columnName": "ASIN"
      },
      {
        "sourceField": "Product",
        "columnName": "Product"
      },
      {
        "sourceField": "Product URL",
        "columnName": "Product URL"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Currency",
        "columnName": "Currency"
      },
      {
        "sourceField": "Rating",
        "columnName": "Rating"
      },
      {
        "sourceField": "Review count",
        "columnName": "Review count"
      },
      {
        "sourceField": "Rank",
        "columnName": "Rank"
      },
      {
        "sourceField": "Prime",
        "columnName": "Prime"
      },
      {
        "sourceField": "Sponsored",
        "columnName": "Sponsored"
      },
      {
        "sourceField": "Best seller",
        "columnName": "Best seller"
      },
      {
        "sourceField": "Amazon choice",
        "columnName": "Amazon choice"
      },
      {
        "sourceField": "Image",
        "columnName": "Image"
      },
      {
        "sourceField": "Delivery",
        "columnName": "Delivery"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "amazon-seller-offers",
    "category": "Products & Shopping",
    "name": "Amazon Seller Offers",
    "description": "Compare seller offers for one Amazon product ASIN.",
    "instructions": "Provide a 10-character Amazon ASIN and choose the verified US marketplace. Each returned seller offer is a row. Seller ID is the preferred identity, with ASIN, seller, condition, and price as a deterministic fallback.",
    "examplePrompts": [
      "Compare seller offers for ASIN B09B8V1LZ3",
      "Who sells this Amazon product and at what prices?"
    ],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      },
      {
        "key": "asin",
        "label": "Amazon ASIN",
        "description": "Exactly 10 letters and digits.",
        "type": "text",
        "required": true
      },
      {
        "key": "marketplace",
        "label": "Amazon marketplace",
        "description": "Currently verified marketplace.",
        "type": "select",
        "options": [
          {
            "label": "United States",
            "value": "us"
          }
        ],
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Offer key",
        "field": "Offer key",
        "width": 180
      },
      {
        "name": "ASIN",
        "field": "ASIN",
        "width": 180
      },
      {
        "name": "Seller ID",
        "field": "Seller ID",
        "width": 180
      },
      {
        "name": "Seller",
        "field": "Seller",
        "width": 180
      },
      {
        "name": "Price",
        "field": "Price",
        "width": 180
      },
      {
        "name": "Currency",
        "field": "Currency",
        "width": 180
      },
      {
        "name": "Condition",
        "field": "Condition",
        "width": 180
      },
      {
        "name": "Shipping cost",
        "field": "Shipping cost",
        "width": 180
      },
      {
        "name": "Shipping time",
        "field": "Shipping time",
        "width": 180
      },
      {
        "name": "Prime",
        "field": "Prime",
        "width": 180
      },
      {
        "name": "Seller rating",
        "field": "Seller rating",
        "width": 180
      },
      {
        "name": "Buy box",
        "field": "Buy box",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Offer key",
      "normalization": "text"
    },
    "operations": [
      "table.amazon.sellers"
    ],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "published",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Offer key",
        "columnName": "Offer key"
      },
      {
        "sourceField": "ASIN",
        "columnName": "ASIN"
      },
      {
        "sourceField": "Seller ID",
        "columnName": "Seller ID"
      },
      {
        "sourceField": "Seller",
        "columnName": "Seller"
      },
      {
        "sourceField": "Price",
        "columnName": "Price"
      },
      {
        "sourceField": "Currency",
        "columnName": "Currency"
      },
      {
        "sourceField": "Condition",
        "columnName": "Condition"
      },
      {
        "sourceField": "Shipping cost",
        "columnName": "Shipping cost"
      },
      {
        "sourceField": "Shipping time",
        "columnName": "Shipping time"
      },
      {
        "sourceField": "Prime",
        "columnName": "Prime"
      },
      {
        "sourceField": "Seller rating",
        "columnName": "Seller rating"
      },
      {
        "sourceField": "Buy box",
        "columnName": "Buy box"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "company-profiles",
    "category": "Companies & Organizations",
    "name": "Company Profiles",
    "description": "Enrich an existing company row with a full profile.",
    "instructions": "The verified company profile operation returns one record for a supplied company identifier\u003b it is an enrichment operation, not a table generator.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "authors-researchers",
    "category": "People",
    "name": "Authors & Researchers",
    "description": "Find authors, researchers, and inventors by subject.",
    "instructions": "The available author/researcher search did not document a stable author identifier or result URL in the inspected schema.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "restaurant-menus",
    "category": "Places & Local Businesses",
    "name": "Restaurant Menus & Dishes",
    "description": "List menu items and dishes from a business.",
    "instructions": "The available menu operation is a single-business lookup and its nested dish rows have no verified stable dish identity or page contract.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "product-reviews",
    "category": "Reviews & Reputation",
    "name": "Product Reviews",
    "description": "Find reviews for a product or marketplace listing.",
    "instructions": "The current Amazon review actor requires an ASIN, but its inspected catalog contract does not expose review-row field names or a stable review identity\u003b publishing it would risk dropping or merging reviews.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "review-summaries",
    "category": "Reviews & Reputation",
    "name": "Business Review Summaries",
    "description": "Summarize customer review themes for companies.",
    "instructions": "Trustpilot supports company summaries by query, but its inspected catalog contract does not document the returned company domain and summary field names needed for a stable row mapper.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "job-salaries",
    "category": "Jobs & Careers",
    "name": "Job Salary Data",
    "description": "Search salary and compensation records by role and region.",
    "instructions": "No inspected Monid salary/compensation search operation was available\u003b employer job-board listings do not provide a salary dataset.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "shipment-records",
    "category": "Trade & Supply Chain",
    "name": "Shipment & Customs Records",
    "description": "Search trade shipments and customs declarations.",
    "instructions": "The available shipment result schema does not guarantee a stable declaration or bill-of-lading identifier\u003b no safe row identity can be published.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  },
  {
    "id": "property-details",
    "category": "Real Estate",
    "name": "Property Details",
    "description": "Enrich an existing property row with full details.",
    "instructions": "Property details are a single-record lookup by Zillow property ID, so this is an enrichment operation rather than a table generator.",
    "examplePrompts": [],
    "requiredInputs": [
      {
        "key": "query",
        "label": "Search description",
        "description": "Natural-language description of the records to find.",
        "type": "text",
        "required": true
      }
    ],
    "defaultColumns": [
      {
        "name": "Result",
        "field": "Result",
        "width": 180
      }
    ],
    "identity": {
      "sourceField": "Result",
      "normalization": "text"
    },
    "operations": [],
    "pagination": {
      "strategy": "none",
      "maxCalls": 1
    },
    "status": "draft",
    "entity": "records",
    "rowMapping": [
      {
        "sourceField": "Result",
        "columnName": "Result"
      }
    ],
    "chaining": {
      "enabled": false,
      "operations": []
    }
  }
]$monid_table_type_seed_032$::jsonb) AS seed(entry)
ON CONFLICT (id) DO NOTHING;
